// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { gamePlayers } from './db/schema';
import { sockets, watching } from './realtime';
import { db } from './runtime/db';
import type { Socket } from './runtime/serve';
import { call, newUser, ORIGIN, pushesTo, type TestUser } from './test-utils';

/** A fake socket, opened as `u` from `origin`, recording what it's sent. */
function connect(u: TestUser, origin = ORIGIN) {
  const got: { t: string; view?: { myRack: string[] | null; players: unknown[] } }[] = [];
  const ws: Socket = { send: (s) => void got.push(JSON.parse(s)), close() {} };
  const w = sockets.accept(new Request(`${ORIGIN}/ws`, { headers: { origin, cookie: u.cookie } }));
  if (w) sockets.open(ws, w);
  return { got, ok: !!w, sub: (sub: string) => w && sockets.message(ws, w, JSON.stringify({ sub })), close: () => w && sockets.close(ws, w) };
}

test('watchers of a game get their own view; players on the lobby get a nudge; nobody else hears anything', async () => {
  const [a, b, stranger] = [await newUser(), await newUser(), await newUser()];
  const id = (await call('/games', { method: 'POST', cookie: a.cookie, body: { name: 'Live', seatCount: 2, bagSize: 100, randomOrder: false } })).json.id;
  const code = (await call(`/games/${id}`, { cookie: a.cookie })).json.joinCode;
  await call(`/join/${code}`, { method: 'POST', cookie: b.cookie });
  await call(`/games/${id}/start`, { method: 'POST', cookie: a.cookie });
  db.update(gamePlayers).set({ rack: [...'CATXYZQ'] }).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.seat, 0))).run();

  expect(connect(a, 'https://evil.test').ok).toBe(false); // cross-site sockets are refused
  const [sa, sb, ss] = [connect(a), connect(b), connect(stranger)];
  sa.sub(id);
  sb.sub('lobby');
  ss.sub(id); // not seated: must get nothing
  expect(watching(a.id, id)).toBe(true);
  expect(watching(b.id, id)).toBe(false);

  const tiles = [{ r: 7, c: 6, letter: 'C' }, { r: 7, c: 7, letter: 'A' }, { r: 7, c: 8, letter: 'T' }];
  expect((await call(`/games/${id}/moves`, { method: 'POST', cookie: a.cookie, body: { turnNumber: 0, type: 'play', tiles } })).status).toBe(200);

  expect(sa.got).toHaveLength(1);
  expect(sa.got[0]!.t).toBe('game');
  expect(sa.got[0]!.view!.myRack).toHaveLength(7); // a's own rack, refilled
  expect(JSON.stringify(sa.got[0])).not.toContain('"rack"'); // no one else's rack (SPEC §6.1)
  expect(sb.got).toEqual([{ t: 'lobby' }]);
  expect(ss.got).toEqual([]);
  expect(pushesTo(b).at(-1)).toContain('Your turn in Live');

  // b opens the game: a's pass reaches b live, with no push
  const before = pushesTo(b).length;
  sb.sub(id);
  expect((await call(`/games/${id}/moves`, { method: 'POST', cookie: b.cookie, body: { turnNumber: 1, type: 'pass' } })).status).toBe(200);
  expect((await call(`/games/${id}/moves`, { method: 'POST', cookie: a.cookie, body: { turnNumber: 2, type: 'pass' } })).status).toBe(200);
  expect(sb.got.at(-1)!.t).toBe('game');
  expect(pushesTo(b)).toHaveLength(before);

  for (const s of [sa, sb, ss]) s.close();
  expect(watching(b.id, id)).toBe(false);
});
