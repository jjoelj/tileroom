// SPDX-License-Identifier: AGPL-3.0-or-later
// Realtime (SPEC §7): notify-only. Clients say what's on screen; after a change, every socket watching that
// game gets its own user's view (player or spectator), and players on the games list get a nudge to refetch.
// All writes stay REST.
import { and, eq, ne } from 'drizzle-orm';
import { requestUser } from './auth';
import { gamePlayers, games, groupMembers } from './db/schema';
import { db } from './runtime/db';
import type { Socket, Sockets } from './runtime/serve';
import { canSpectate, isMember, lastMove, type LoadedGame, loadGame } from './store';
import { toView, type Watcher } from './view';

type Conn = { userId: string; displayName: string; sub: string };
const live = new Map<Socket, Conn>();

const GROUP = 'group:';
const isGame = (sub: string) => sub !== '' && sub !== 'lobby' && !sub.startsWith(GROUP);

export const sockets: Sockets<Conn> = {
  path: '/ws',
  accept(req) {
    const user = requestUser(req);
    return user ? { userId: user.id, displayName: user.displayName, sub: '' } : null;
  },
  open(ws, c) {
    live.set(ws, c);
  },
  message(ws, c, text) {
    // {"sub": "<gameId>" | "group:<groupId>" | "lobby" | ""}; "" while the app is hidden, so it isn't counted as watching
    let sub: unknown;
    try {
      sub = JSON.parse(text).sub;
    } catch {
      return ws.close(1003, 'bad message');
    }
    if (typeof sub !== 'string' || sub.length > 64 || sub === c.sub) return;
    const before = c.sub;
    c.sub = sub;
    // someone arrived or left: the watcher lists on both games change
    for (const id of [before, sub]) if (isGame(id)) changed(id, { lobby: false });
    // back on screen (e.g. refocused): refetch whatever changed while it was unsubscribed, like games get a fresh view
    if (sub === 'lobby') ws.send(JSON.stringify({ t: 'lobby' }));
    else if (sub.startsWith(GROUP) && isMember(db, sub.slice(GROUP.length), c.userId)) ws.send(JSON.stringify({ t: 'group' }));
  },
  close(ws, c) {
    live.delete(ws);
    if (isGame(c.sub)) changed(c.sub, { lobby: false });
  },
};

/** Spectators on screen right now: group members, not seated, with the game open. One entry per person. */
function watchersOf(g: LoadedGame): Watcher[] {
  if (!g.group) return [];
  const seen = new Map<string, Watcher>();
  for (const c of live.values()) {
    if (c.sub === g.game.id && !seen.has(c.userId) && canSpectate(db, g, c.userId)) seen.set(c.userId, { userId: c.userId, displayName: c.displayName });
  }
  return [...seen.values()];
}

/** Seated players with this game open and in front right now (a hidden or unfocused app subscribes to nothing). */
const hereIn = (g: LoadedGame) =>
  new Set([...live.values()].filter((c) => c.sub === g.game.id && g.seats.some((s) => s.userId === c.userId)).map((c) => c.userId));

/** The view a user gets of a game: player view if seated, spectator view if allowed, else nothing. */
export function viewOf(g: LoadedGame, userId: string) {
  const seat = g.seats.find((s) => s.userId === userId)?.seat;
  if (seat === undefined && !canSpectate(db, g, userId)) return null;
  return toView(g, seat ?? null, lastMove(db, g.game.id), watchersOf(g), hereIn(g));
}

/** Call after any committed change to a game (or to who's watching it). */
export function changed(gameId: string, { lobby = true } = {}) {
  const g = loadGame(db, gameId);
  if (!g) return;
  const last = lastMove(db, gameId);
  const watching = watchersOf(g);
  const here = hereIn(g);
  for (const [ws, c] of live) {
    const seat = g.seats.find((s) => s.userId === c.userId)?.seat;
    if (c.sub === gameId) {
      if (seat !== undefined) ws.send(JSON.stringify({ t: 'game', view: toView(g, seat, last, watching, here) }));
      else if (canSpectate(db, g, c.userId)) ws.send(JSON.stringify({ t: 'game', view: toView(g, null, last, watching, here) }));
    } else if (lobby && seat !== undefined && c.sub === 'lobby') ws.send(JSON.stringify({ t: 'lobby' }));
  }
  if (lobby && g.group) groupChanged(g.group.id); // the group screen lists its games
}

/**
 * Call after any committed change to a group (members, votes, words, settings, its games). Members with the group
 * open get a nudge to refetch it; members on the games list too, since it shows their groups and pending votes.
 */
export function groupChanged(groupId: string, formerMembers?: string[]) {
  const member = (userId: string) => (formerMembers ? formerMembers.includes(userId) : isMember(db, groupId, userId));
  for (const [ws, c] of live) {
    if (c.sub !== `${GROUP}${groupId}` && c.sub !== 'lobby') continue;
    if (!member(c.userId)) continue; // leavers, and anyone guessing ids, hear nothing
    ws.send(JSON.stringify(c.sub === 'lobby' ? { t: 'lobby' } : { t: 'group' }));
  }
}

/** A user changed their display name: their open games and groups re-render with it. */
export function renamed(userId: string, displayName: string) {
  for (const c of live.values()) if (c.userId === userId) c.displayName = displayName; // watcher lists
  const gameIds = db
    .select({ id: gamePlayers.gameId })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(and(eq(gamePlayers.userId, userId), ne(games.status, 'finished')))
    .all();
  for (const { id } of gameIds) changed(id);
  const groupIds = db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId)).all();
  for (const { id } of groupIds) groupChanged(id);
  // and anyone watching a game I'm watching sees the new name in its watcher list
  for (const c of live.values()) if (c.userId === userId && isGame(c.sub)) changed(c.sub, { lobby: false });
}

/** Whether the user has this group's page open on screen right now (they see changes live; no push needed). */
export const watchingGroup = (userId: string, groupId: string) => [...live.values()].some((c) => c.userId === userId && c.sub === `${GROUP}${groupId}`);

/** Whether the user has this game open on screen right now (they don't need a push about it). */
export const watching = (userId: string, gameId: string) => [...live.values()].some((c) => c.userId === userId && c.sub === gameId);
