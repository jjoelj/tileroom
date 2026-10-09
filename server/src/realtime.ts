// SPDX-License-Identifier: AGPL-3.0-or-later
// Realtime (SPEC §7): notify-only. Clients say what's on screen; after a change, every socket watching that
// game gets its own user's view, and players on the games list get a nudge to refetch. All writes stay REST.
import { requestUser } from './auth';
import { db } from './runtime/db';
import type { Socket, Sockets } from './runtime/serve';
import { lastMove, loadGame } from './store';
import { toView } from './view';

type Watcher = { userId: string; sub: string };
const live = new Map<Socket, Watcher>();

export const sockets: Sockets<Watcher> = {
  path: '/ws',
  accept(req) {
    const user = requestUser(req);
    return user ? { userId: user.id, sub: '' } : null;
  },
  open(ws, w) {
    live.set(ws, w);
  },
  message(ws, w, text) {
    // {"sub": "<gameId>" | "lobby" | ""}; "" while the app is hidden, so it isn't counted as watching
    try {
      const sub: unknown = JSON.parse(text).sub;
      if (typeof sub === 'string' && sub.length <= 64) w.sub = sub;
    } catch {
      ws.close(1003, 'bad message');
    }
  },
  close(ws) {
    live.delete(ws);
  },
};

/** Call after any committed change to a game. Only seated players hear about it (spectators: milestone 5). */
export function changed(gameId: string) {
  const g = loadGame(db, gameId);
  if (!g) return;
  const last = lastMove(db, gameId);
  for (const [ws, w] of live) {
    const seat = g.seats.find((s) => s.userId === w.userId)?.seat;
    if (seat === undefined) continue;
    if (w.sub === gameId) ws.send(JSON.stringify({ t: 'game', view: toView(g, seat, last) }));
    else if (w.sub === 'lobby') ws.send(JSON.stringify({ t: 'lobby' }));
  }
}

/** Whether the user has this game open on screen right now (they don't need a push about it). */
export const watching = (userId: string, gameId: string) => [...live.values()].some((w) => w.userId === userId && w.sub === gameId);
