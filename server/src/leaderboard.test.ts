// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { randomId } from './codes';
import { gamePlayers, games } from './db/schema';
import { db } from './runtime/db';
import { call, newUser, type TestUser } from './test-utils';

/** A game with these final scores, in seat order. */
function played(players: [TestUser, number][], groupId: string | null = null, status: 'finished' | 'active' = 'finished') {
  const id = randomId();
  db.insert(games).values({ id, hostId: players[0]![0].id, bagSize: 100, randomOrder: false, joinCode: randomId().slice(0, 6), status, groupId }).run();
  players.forEach(([u, score], seat) => void db.insert(gamePlayers).values({ gameId: id, seat, userId: u.id, score }).run());
}

type Row = { userId: string; games: number; wins: number; points: number; best: number; listed: boolean };
const board = async (u: TestUser, group?: string) => {
  const r = await call(`/leaderboard${group ? `?group=${group}` : ''}`, { cookie: u.cookie });
  return { status: r.status, rows: (r.json?.rows ?? []) as Row[], me: r.json?.me as Row | null };
};
const rowOf = (rows: Row[], u: TestUser) => rows.find((r) => r.userId === u.id);

test('wins (ties count), points and best game; group boards count only that group, members only', async () => {
  const [a, b, c, outsider] = [await newUser(), await newUser(), await newUser(), await newUser()];
  const g = (await call('/groups', { method: 'POST', cookie: a.cookie, body: { name: 'Board' } })).json;
  await call(`/groups/join/${g.joinCode}`, { method: 'POST', cookie: b.cookie });

  played([[a, 300], [b, 250]], g.id); // a wins
  played([[a, 200], [b, 200]], g.id); // tie: both win
  played([[b, 310], [c, 100]]); // outside the group
  played([[a, 999], [b, 1]], g.id, 'active'); // not finished: doesn't count

  const global = (await board(a)).rows;
  expect(rowOf(global, a)).toMatchObject({ games: 2, wins: 2, points: 500, best: 300 });
  expect(rowOf(global, b)).toMatchObject({ games: 3, wins: 2, points: 760, best: 310 });
  expect(rowOf(global, c)).toMatchObject({ games: 1, wins: 0, points: 100, best: 100 });
  expect((await board(outsider)).me).toMatchObject({ games: 0, wins: 0, points: 0, best: 0, listed: true }); // on the board before any game

  const group = (await board(a, g.id)).rows;
  expect(rowOf(group, b)).toMatchObject({ games: 2, wins: 1, points: 450 }); // the outside game isn't here
  expect(rowOf(group, c)).toBeUndefined(); // not a member
  expect((await board(outsider, g.id)).status).toBe(404);
});

test('opting out of the global board: hidden from others, still on group boards, still sees their own place', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const g = (await call('/groups', { method: 'POST', cookie: a.cookie, body: { name: 'Opt' } })).json;
  await call(`/groups/join/${g.joinCode}`, { method: 'POST', cookie: b.cookie });
  played([[a, 100], [b, 50]], g.id);
  await call('/me/settings', { method: 'PATCH', cookie: b.cookie, body: { showOnGlobal: false } });

  expect(rowOf((await board(a)).rows, b)).toBeUndefined();
  expect(rowOf((await board(a, g.id)).rows, b)).toBeDefined();
  const own = await board(b);
  expect(rowOf(own.rows, b)).toBeUndefined(); // not in the shared list...
  expect(own.me).toMatchObject({ userId: b.id, games: 1, points: 50, listed: false }); // ...but b sees where they'd be
});
