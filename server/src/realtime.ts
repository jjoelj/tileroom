// SPDX-License-Identifier: AGPL-3.0-or-later
// Realtime (SPEC §7): notify-only. Clients say what's on screen; after a change, every socket watching that
// game gets its own user's view (player or spectator), and players on the games list get a nudge to refetch.
// All writes stay REST.
import { requestUser } from './auth';
import { db } from './runtime/db';
import type { Socket, Sockets } from './runtime/serve';
import { canSpectate, lastMove, type LoadedGame, loadGame } from './store';
import { toView, type Watcher } from './view';

type Conn = { userId: string; displayName: string; sub: string };
const live = new Map<Socket, Conn>();

const isGame = (sub: string) => sub !== '' && sub !== 'lobby';

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
    // {"sub": "<gameId>" | "lobby" | ""}; "" while the app is hidden, so it isn't counted as watching
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

/** The view a user gets of a game: player view if seated, spectator view if allowed, else nothing. */
export function viewOf(g: LoadedGame, userId: string) {
  const seat = g.seats.find((s) => s.userId === userId)?.seat;
  if (seat === undefined && !canSpectate(db, g, userId)) return null;
  return toView(g, seat ?? null, lastMove(db, g.game.id), watchersOf(g));
}

/** Call after any committed change to a game (or to who's watching it). */
export function changed(gameId: string, { lobby = true } = {}) {
  const g = loadGame(db, gameId);
  if (!g) return;
  const last = lastMove(db, gameId);
  const watching = watchersOf(g);
  for (const [ws, c] of live) {
    const seat = g.seats.find((s) => s.userId === c.userId)?.seat;
    if (c.sub === gameId) {
      if (seat !== undefined) ws.send(JSON.stringify({ t: 'game', view: toView(g, seat, last, watching) }));
      else if (canSpectate(db, g, c.userId)) ws.send(JSON.stringify({ t: 'game', view: toView(g, null, last, watching) }));
    } else if (lobby && seat !== undefined && c.sub === 'lobby') ws.send(JSON.stringify({ t: 'lobby' }));
  }
}

/** Whether the user has this game open on screen right now (they don't need a push about it). */
export const watching = (userId: string, gameId: string) => [...live.values()].some((c) => c.userId === userId && c.sub === gameId);
