// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { randomId } from './codes';
import { gamePlayers, games } from './db/schema';
import { db } from './runtime/db';
import { call, newUser, type TestUser } from './test-utils';

/** A finished game with these final scores, in seat order. */
function finished(players: [TestUser, number][], groupId: string | null = null, status: 'finished' | 'active' = 'finished') {
  const id = randomId();
  db.insert(games).values({ id, hostId: players[0]![0].id, bagSize: 100, randomOrder: false, joinCode: randomId().slice(0, 6), status, groupId }).run();
  players.forEach(([u, score], seat) => void db.insert(gamePlayers).values({ gameId: id, seat, userId: u.id, score }).run());
}

type Row = { userId: string; games: number; wins: number; points: number; best: number };
const board = async (u: TestUser, group?: string) => {
  const r = await call(`/leaderboard${group ? `?group=${group}` : ''}`, { cookie: u.cookie });
  return { status: r.status, rows: (r.json?.rows ?? []) as Row[] };
};
const rowOf = (rows: Row[], u: TestUser) => rows.find((r) => r.userId === u.id);

test('wins (ties count), points and best game; group boards count only that group, members only; global opt-out', async () => {
  const [a, b, c, outsider] = [await newUser(), await newUser(), await newUser(), await newUser()];
  const g = (await call('/groups', { method: 'POST', cookie: a.cookie, body: { name: 'Board' } })).json;
  await call(`/groups/join/${g.joinCode}`, { method: 'POST', cookie: b.cookie });

  finished([[a, 300], [b, 250]], g.id); // a wins
  finished([[a, 200], [b, 200]], g.id); // tie: both win
  finished([[b, 310], [c, 100]]); // outside the group
  finished([[a, 999], [b, 1]], g.id, 'active'); // not finished: doesn't count

  const global = (await board(a)).rows;
  expect(rowOf(global, a)).toMatchObject({ games: 2, wins: 2, points: 500, best: 300 });
  expect(rowOf(global, b)).toMatchObject({ games: 3, wins: 2, points: 760, best: 310 });
  expect(rowOf(global, c)).toMatchObject({ games: 1, wins: 0, points: 100, best: 100 });

  const group = (await board(a, g.id)).rows;
  expect(rowOf(group, b)).toMatchObject({ games: 2, wins: 1, points: 450 }); // the outside game isn't here
  expect(rowOf(group, c)).toBeUndefined(); // not a member
  expect((await board(outsider, g.id)).status).toBe(404);

  await call('/me/settings', { method: 'PATCH', cookie: b.cookie, body: { showOnGlobal: false } });
  expect(rowOf((await board(a)).rows, b)).toBeUndefined();
  expect(rowOf((await board(a, g.id)).rows, b)).toBeDefined(); // still on group boards
});
