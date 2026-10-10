// SPDX-License-Identifier: AGPL-3.0-or-later
// Realtime (SPEC §7): notify-only. Clients say what's on screen; after a change, every socket watching that
// game gets its own user's view (player or spectator), and players on the games list get a nudge to refetch.
// The one thing a client sends besides what's on screen: the squares it has tiles on during its own turn, passed on to
// the others with that game open as letterless tiles, never stored. All writes stay REST.
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { SIZE } from '../../shared/board';
import { RACK_SIZE } from '../../shared/tiles';
import { requestUser } from './auth';
import { gamePlayers, games, groupMembers } from './db/schema';
import { db } from './runtime/db';
import type { Socket, Sockets } from './runtime/serve';
import { canSpectate, isMember, lastMove, type LoadedGame, loadGame } from './store';
import { toView, type Watcher } from './view';

/** `sub`: what's on screen (live updates go there). `focused`: in front too, so the user is really looking: only then are
 * they "here" or watching, and spared a push. */
type Conn = { userId: string; displayName: string; sub: string; focused: boolean };
const live = new Map<Socket, Conn>();

const GROUP = 'group:';
const isGame = (sub: string) => sub !== '' && sub !== 'lobby' && !sub.startsWith(GROUP);
const looking = (c: Conn, sub: string) => c.focused && c.sub === sub;

/** Squares the player whose turn it is has tiles on right now, by game. In memory: it's only ever a live glimpse. */
type Placing = { userId: string; turn: number; squares: [number, number][] };
const placing = new Map<string, Placing>();
const Squares = z.array(z.tuple([z.int().min(0).max(SIZE - 1), z.int().min(0).max(SIZE - 1)])).max(RACK_SIZE);

/** Everyone else with the game open who may see it: the other players and, for group games, members watching. */
function others(g: LoadedGame, userId: string) {
  return [...live].filter(([, c]) => c.sub === g.game.id && c.userId !== userId && (g.seats.some((s) => s.userId === c.userId) || canSpectate(db, g, c.userId)));
}
const placingMessage = (gameId: string, p: Placing) => JSON.stringify({ t: 'placing', id: gameId, turn: p.turn, squares: p.squares });

/** The mover's squares changed (or they left the game screen: none). Only theirs, only on their turn. */
function place(c: Conn, raw: unknown) {
  const squares = Squares.safeParse(raw);
  const g = isGame(c.sub) ? loadGame(db, c.sub) : undefined;
  const seat = g?.seats.find((s) => s.userId === c.userId)?.seat;
  if (!squares.success || !g || !g.game.livePlacing || g.game.status !== 'active' || seat !== g.game.currentSeat) return;
  const p = { userId: c.userId, turn: g.game.turnNumber, squares: squares.data };
  if (p.squares.length) placing.set(g.game.id, p);
  else placing.delete(g.game.id);
  for (const [ws] of others(g, c.userId)) ws.send(placingMessage(g.game.id, p));
}

/** The mover stopped looking at the game (left it, or their app closed): their tiles vanish for everyone else. */
function stopPlacing(c: Conn, gameId: string) {
  if (placing.get(gameId)?.userId !== c.userId) return;
  if ([...live.values()].some((o) => o !== c && o.userId === c.userId && o.sub === gameId)) return; // still open elsewhere
  const p = placing.get(gameId)!;
  placing.delete(gameId);
  const g = loadGame(db, gameId);
  if (g) for (const [ws] of others(g, c.userId)) ws.send(placingMessage(gameId, { ...p, squares: [] }));
}

export const sockets: Sockets<Conn> = {
  path: '/ws',
  accept(req) {
    const user = requestUser(req);
    return user ? { userId: user.id, displayName: user.displayName, sub: '', focused: false } : null;
  },
  open(ws, c) {
    live.set(ws, c);
  },
  message(ws, c, text) {
    // {"sub": "<gameId>" | "group:<groupId>" | "lobby" | "", "focused": boolean}; sub "" while the app is hidden
    let sub: unknown;
    let focused: unknown;
    let squares: unknown;
    try {
      ({ sub, focused = true, placing: squares } = JSON.parse(text)); // an app from before `focused` sends "" when not in front
    } catch {
      return ws.close(1003, 'bad message');
    }
    if (squares !== undefined) return place(c, squares); // {"placing": [[r, c], …]}
    if (typeof sub !== 'string' || sub.length > 64 || typeof focused !== 'boolean') return;
    if (sub === c.sub && focused === c.focused) return;
    const before = c.sub;
    c.focused = focused;
    c.sub = sub;
    for (const id of new Set([before, sub])) if (isGame(id)) changed(id, { lobby: false }); // who's here or watching changed
    if (sub === before) return;
    if (isGame(before)) stopPlacing(c, before);
    // just opened a game someone is placing on: show where, if allowed
    const p = isGame(sub) && placing.get(sub);
    const g = p && loadGame(db, sub);
    if (p && g && others(g, p.userId).some(([s]) => s === ws)) ws.send(placingMessage(sub, p));
    // back on screen (e.g. refocused): refetch whatever changed while it was unsubscribed, like games get a fresh view
    if (sub === 'lobby') ws.send(JSON.stringify({ t: 'lobby' }));
    else if (sub.startsWith(GROUP) && isMember(db, sub.slice(GROUP.length), c.userId)) ws.send(JSON.stringify({ t: 'group' }));
  },
  close(ws, c) {
    live.delete(ws);
    if (isGame(c.sub)) stopPlacing(c, c.sub);
    if (isGame(c.sub)) changed(c.sub, { lobby: false });
  },
};

/** Spectators on screen right now: group members, not seated, with the game open. One entry per person. */
function watchersOf(g: LoadedGame): Watcher[] {
  if (!g.group) return [];
  const seen = new Map<string, Watcher>();
  for (const c of live.values()) {
    if (looking(c, g.game.id) && !seen.has(c.userId) && canSpectate(db, g, c.userId)) seen.set(c.userId, { userId: c.userId, displayName: c.displayName });
  }
  return [...seen.values()];
}

/** Seated players with this game open and in front right now (a hidden or unfocused app subscribes to nothing). */
const hereIn = (g: LoadedGame) =>
  new Set([...live.values()].filter((c) => looking(c, g.game.id) && g.seats.some((s) => s.userId === c.userId)).map((c) => c.userId));

/** The view a user gets of a game: player view if seated, spectator view if allowed, else nothing. */
export function viewOf(g: LoadedGame, userId: string) {
  const seat = g.seats.find((s) => s.userId === userId)?.seat;
  if (seat === undefined && !canSpectate(db, g, userId)) return null;
  return toView(g, seat ?? null, lastMove(db, g.game.id), watchersOf(g), hereIn(g));
}

/** Call after any committed change to a game (or to who's watching it). */
export function changed(gameId: string, { lobby = true } = {}) {
  const g = loadGame(db, gameId);
  if (!g) return void placing.delete(gameId);
  if (placing.get(gameId)?.turn !== g.game.turnNumber) placing.delete(gameId); // they moved: the tiles are real now
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
export const watchingGroup = (userId: string, groupId: string) => [...live.values()].some((c) => c.userId === userId && looking(c, `${GROUP}${groupId}`));

/** Whether the user has this game open on screen right now (they don't need a push about it). */
export const watching = (userId: string, gameId: string) => [...live.values()].some((c) => c.userId === userId && looking(c, gameId));

/** Closes every socket a user has open (their account is gone; sockets were authenticated once, at connect). */
export function disconnect(userId: string) {
  const games = new Set<string>();
  for (const [ws, c] of live) {
    if (c.userId !== userId) continue;
    live.delete(ws); // now, not when the close lands: no view reaches it in between
    ws.close(1008, 'signed out');
    if (isGame(c.sub)) games.add(c.sub);
  }
  for (const id of games) changed(id, { lobby: false }); // no longer "here"
}

/**
 * A game was deleted (canceled, or voided by the turn timeout): whoever has it open and may see it is told it's gone,
 * its players' games lists refetch, and so does its group's page.
 */
export function gone(g: LoadedGame) {
  const seated = (userId: string) => g.seats.some((s) => s.userId === userId);
  for (const [ws, c] of live) {
    if (c.sub === g.game.id && (seated(c.userId) || canSpectate(db, g, c.userId))) ws.send(JSON.stringify({ t: 'gone', id: g.game.id }));
    else if (c.sub === 'lobby' && seated(c.userId)) ws.send(JSON.stringify({ t: 'lobby' }));
  }
  if (g.group) groupChanged(g.group.id);
}
