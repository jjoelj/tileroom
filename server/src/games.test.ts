// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { TURN_TIMEOUT_MS } from '../../shared/rules';
import { gamePlayers, games, moves, users } from './db/schema';
import { runJobs } from './games';
import { resetRateLimits } from './http';
import { db } from './runtime/db';
import { call, newUser, pushesTo, type TestUser } from './test-utils';

beforeEach(resetRateLimits);

const DAY = 86_400_000;

async function lobby(seatCount = 2, randomOrder = false) {
  const host = await newUser();
  const r = await call('/games', { method: 'POST', cookie: host.cookie, body: { name: 'Thursday Night', seatCount, bagSize: 100, randomOrder } });
  expect(r.status).toBe(201);
  return { host, id: r.json.id as string, joinCode: r.json.joinCode as string };
}

/** A started game with `n` players in seat order (no random order). */
async function started(n = 2) {
  const { host, id, joinCode } = await lobby(n);
  const players = [host];
  for (let i = 1; i < n; i++) {
    const u = await newUser();
    expect((await call(`/join/${joinCode}`, { method: 'POST', cookie: u.cookie })).status).toBe(200);
    players.push(u);
  }
  expect((await call(`/games/${id}/start`, { method: 'POST', cookie: host.cookie })).status).toBe(200);
  return { id, players };
}

const setRack = (id: string, seat: number, letters: string) =>
  db.update(gamePlayers).set({ rack: [...letters] }).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.seat, seat))).run();

const view = (id: string, u: TestUser) => call(`/games/${id}`, { cookie: u.cookie });
const move = (id: string, u: TestUser, body: object) => call(`/games/${id}/moves`, { method: 'POST', cookie: u.cookie, body });
const CAT = { turnNumber: 0, type: 'play', tiles: [{ r: 7, c: 6, letter: 'C' }, { r: 7, c: 7, letter: 'A' }, { r: 7, c: 8, letter: 'T' }] };

describe('lobby', () => {
  test('create, preview, join, start', async () => {
    const { host, id, joinCode } = await lobby(3);
    expect(joinCode).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    const guest = await newUser();
    const preview = await call(`/join/${joinCode.toLowerCase().replace('-', '')}`, { cookie: guest.cookie });
    expect(preview.json).toMatchObject({ id, name: 'Thursday Night', seatCount: 3, players: ['User ' + host.username.match(/\d+/)![0]], joined: false });
    expect((await call(`/games/${id}/start`, { method: 'POST', cookie: host.cookie })).json.error).toBe('not_enough_players');
    await call(`/join/${joinCode}`, { method: 'POST', cookie: guest.cookie });
    expect((await call(`/games/${id}/start`, { method: 'POST', cookie: guest.cookie })).json.error).toBe('not_host');
    const s = await call(`/games/${id}/start`, { method: 'POST', cookie: host.cookie });
    expect(s.json).toMatchObject({ status: 'active', seatCount: 2, joinCode: null, turnNumber: 0, currentSeat: 0, bagCount: 86 });
    expect(pushesTo(guest)).toContain('Thursday Night has started.');
    expect((await call(`/join/${joinCode}`, { method: 'POST', cookie: (await newUser()).cookie })).json.error).toBe('already_started');
  });

  test('full games and bad codes', async () => {
    const { joinCode } = await lobby(2);
    await call(`/join/${joinCode}`, { method: 'POST', cookie: (await newUser()).cookie });
    expect((await call(`/join/${joinCode}`, { method: 'POST', cookie: (await newUser()).cookie })).json.error).toBe('game_full');
    expect((await call('/join/ZZZ-ZZZ', { cookie: (await newUser()).cookie })).status).toBe(404);
  });

  test('host can rename and resize, not below seated players', async () => {
    const { host, id, joinCode } = await lobby(4);
    await call(`/join/${joinCode}`, { method: 'POST', cookie: (await newUser()).cookie });
    expect((await call(`/games/${id}`, { method: 'PATCH', cookie: host.cookie, body: { seatCount: 1 } })).status).toBe(400);
    const r = await call(`/games/${id}`, { method: 'PATCH', cookie: host.cookie, body: { seatCount: 2, name: 'Fri' } });
    expect(r.json).toMatchObject({ name: 'Fri', seatCount: 2 });
  });

  test('random order still seats everyone once', async () => {
    const { host, id, joinCode } = await lobby(3, true);
    const a = await newUser();
    const b = await newUser();
    for (const u of [a, b]) await call(`/join/${joinCode}`, { method: 'POST', cookie: u.cookie });
    const s = await call(`/games/${id}/start`, { method: 'POST', cookie: host.cookie });
    expect(s.json.players.map((p: { userId: string }) => p.userId).sort()).toEqual([host.id, a.id, b.id].sort());
  });
});

describe('need-to-know', () => {
  test('a player sees only their own rack; outsiders and admins get 404', async () => {
    const { id, players } = await started(3);
    const v = (await view(id, players[1]!)).json;
    expect(v.mySeat).toBe(1);
    expect(v.myRack).toHaveLength(7);
    expect(v.players.map((p: { rackCount: number }) => p.rackCount)).toEqual([7, 7, 7]);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"bag"');
    expect(json).not.toContain('"rack"');
    const outsider = await newUser();
    db.update(users).set({ isAdmin: true }).where(eq(users.id, outsider.id)).run();
    expect((await view(id, outsider)).status).toBe(404);
    expect((await call(`/games/${id}/log`, { cookie: outsider.cookie })).status).toBe(404);
  });

  test('a swap shows others only the count; the swapper sees the letters', async () => {
    const { id, players } = await started(2);
    setRack(id, 0, 'QQQABCD');
    db.update(games).set({ bag: { Q: 0, E: 50 } }).where(eq(games.id, id)).run();
    const r = await move(id, players[0]!, { turnNumber: 0, type: 'swap', swap: ['Q', 'Q'] });
    expect(r.json.lastMove).toEqual({ seat: 0, turn: 0, type: 'swap', count: 2 });
    const theirs = (await call(`/games/${id}/log`, { cookie: players[1]!.cookie })).json.moves;
    const mine = (await call(`/games/${id}/log`, { cookie: players[0]!.cookie })).json.moves;
    expect(theirs).toEqual([{ seat: 0, turn: 0, type: 'swap', count: 2 }]);
    expect(mine).toEqual([{ seat: 0, turn: 0, type: 'swap', count: 2, private: { swapped: ['Q', 'Q'], drawn: ['E', 'E'] } }]);
  });
});

describe('moves', () => {
  test('a valid play scores on the server, refills, and pushes the next player', async () => {
    const { id, players } = await started(2);
    setRack(id, 0, 'CATXYZQ');
    const r = await move(id, players[0]!, { ...CAT, score: 999 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ turnNumber: 1, currentSeat: 1 });
    expect(r.json.myRack).toHaveLength(7);
    expect(r.json.players[0].score).toBe(5);
    expect(r.json.lastMove).toEqual({ seat: 0, turn: 0, type: 'play', tiles: CAT.tiles.map((t) => ({ ...t, blank: false })), words: [{ word: 'CAT', score: 5 }], score: 5 });
    expect(pushesTo(players[1]!).at(-1)).toMatch(/^Your turn in Thursday Night — User \d+ played CAT \(5\)$/);
  });

  test('stale turn number: 409 and nothing changes', async () => {
    const { id, players } = await started(2);
    setRack(id, 0, 'CATXYZQ');
    const r = await move(id, players[0]!, { ...CAT, turnNumber: 5 });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('stale_turn');
    expect((await view(id, players[0]!)).json).toMatchObject({ turnNumber: 0, myRack: [...'CATXYZQ'] });
    expect(db.select().from(moves).where(eq(moves.gameId, id)).all()).toHaveLength(0);
  });

  test("not your turn, words not in the list, letters you don't have", async () => {
    const { id, players } = await started(2);
    setRack(id, 0, 'ZQXCATV');
    expect((await move(id, players[1]!, { turnNumber: 0, type: 'pass' })).json.error).toBe('not_your_turn');
    const bad = await move(id, players[0]!, { turnNumber: 0, type: 'play', tiles: [{ r: 7, c: 7, letter: 'Z' }, { r: 7, c: 8, letter: 'Q' }] });
    expect(bad.json).toEqual({ error: 'invalid_move', message: "ZQ isn't in this game's word list" });
    const missing = await move(id, players[0]!, { turnNumber: 0, type: 'play', tiles: [{ r: 7, c: 7, letter: 'D' }, { r: 7, c: 8, letter: 'O' }] });
    expect(missing.json.message).toBe("You don't have a D");
    expect((await move(id, players[0]!, { turnNumber: 0, type: 'dance' })).json.error).toBe('invalid_body');
  });

  test('a stalemate finishes the game: finalRacks and winners appear, others are told', async () => {
    const { id, players } = await started(2);
    expect((await view(id, players[0]!)).json.finalRacks).toBeUndefined();
    for (let t = 0; t < 4; t++) await move(id, players[t % 2]!, { turnNumber: t, type: 'pass' });
    const v = (await view(id, players[0]!)).json;
    expect(v.status).toBe('finished');
    expect(v.finalRacks).toHaveLength(2);
    expect(v.winnerSeats).toEqual([0, 1]);
    expect(pushesTo(players[0]!).at(-1)).toBe('Thursday Night is over. See who won.');
    expect((await move(id, players[0]!, { turnNumber: 4, type: 'pass' })).json.error).toBe('game_not_active');
  });
});

describe('expanded word list', () => {
  const FAQ = { turnNumber: 0, type: 'play', tiles: [{ r: 7, c: 6, letter: 'F' }, { r: 7, c: 7, letter: 'A' }, { r: 7, c: 8, letter: 'Q' }] };

  test('off by default: abbreviations are rejected', async () => {
    const { id, players } = await started(2);
    expect((await view(id, players[0]!)).json.expandedWords).toBe(false);
    setRack(id, 0, 'FAQXYZE');
    expect((await move(id, players[0]!, FAQ)).json.message).toBe("FAQ isn't in this game's word list");
  });

  test('the host can turn it on in the lobby; abbreviations then count', async () => {
    const { host, id, joinCode } = await lobby(2);
    const r = await call(`/games/${id}`, { method: 'PATCH', cookie: host.cookie, body: { expandedWords: true } });
    expect(r.json.expandedWords).toBe(true);
    const guest = await newUser();
    await call(`/join/${joinCode}`, { method: 'POST', cookie: guest.cookie });
    await call(`/games/${id}/start`, { method: 'POST', cookie: host.cookie });
    setRack(id, 0, 'FAQXYZE');
    const played = await move(id, host, FAQ);
    expect(played.status).toBe(200);
    expect(played.json.lastMove.words).toEqual([{ word: 'FAQ', score: 15 }]);
  });
});

describe('nudge', () => {
  test('others can nudge the current player once a day', async () => {
    const { id, players } = await started(3);
    const [p0, p1, p2] = players as [TestUser, TestUser, TestUser];
    expect((await call(`/games/${id}/nudge`, { method: 'POST', cookie: p0.cookie })).json.error).toBe('your_turn');
    expect((await call(`/games/${id}/nudge`, { method: 'POST', cookie: p1.cookie })).status).toBe(200);
    expect(pushesTo(p0).at(-1)).toMatch(/^User \d+ nudged you: it's your turn in Thursday Night$/);
    expect((await call(`/games/${id}/nudge`, { method: 'POST', cookie: p1.cookie })).status).toBe(429);
    expect((await call(`/games/${id}/nudge`, { method: 'POST', cookie: p2.cookie })).status).toBe(200);
    expect((await view(id, p0)).json.turnNumber).toBe(0);
  });
});

describe('7-day turn timeout', () => {
  const age = (id: string, ms: number) => db.update(games).set({ turnStartedAt: Date.now() - ms }).where(eq(games.id, id)).run();
  const exists = (id: string) => !!db.select().from(games).where(eq(games.id, id)).get();

  test('reminder with 1 day left, once, only if the setting is on', async () => {
    const { id, players } = await started(2);
    const quiet = await started(2);
    await call('/me/settings', { method: 'PATCH', cookie: quiet.players[0]!.cookie, body: { remindTurn: false } });
    age(id, TURN_TIMEOUT_MS - DAY + 1000);
    age(quiet.id, TURN_TIMEOUT_MS - DAY + 1000);
    await runJobs();
    await runJobs();
    const reminder = 'Your turn in Thursday Night: 1 day left before the game is cancelled.';
    expect(pushesTo(players[0]!).filter((b) => b === reminder)).toHaveLength(1);
    expect(pushesTo(quiet.players[0]!)).not.toContain(reminder);
  });

  test('the job voids expired games without a trace or a push', async () => {
    const { id, players } = await started(2);
    setRack(id, 0, 'CATXYZQ');
    await move(id, players[0]!, CAT);
    age(id, TURN_TIMEOUT_MS);
    const before = pushesTo(players[0]!).length;
    await runJobs();
    expect(exists(id)).toBe(false);
    expect(db.select().from(moves).where(eq(moves.gameId, id)).all()).toHaveLength(0);
    expect(db.select().from(gamePlayers).where(eq(gamePlayers.gameId, id)).all()).toHaveLength(0);
    expect(pushesTo(players[0]!)).toHaveLength(before);
  });

  test('a move or a view on an expired game voids it', async () => {
    const a = await started(2);
    age(a.id, TURN_TIMEOUT_MS);
    expect((await move(a.id, a.players[0]!, { turnNumber: 0, type: 'pass' })).status).toBe(410);
    expect(exists(a.id)).toBe(false);
    const b = await started(2);
    age(b.id, TURN_TIMEOUT_MS);
    expect((await view(b.id, b.players[1]!)).status).toBe(404);
    expect(exists(b.id)).toBe(false);
  });

  test('the games list drops expired games', async () => {
    const { id, players } = await started(2);
    expect((await call('/games', { cookie: players[0]!.cookie })).json.yourTurn.map((g: { id: string }) => g.id)).toEqual([id]);
    age(id, TURN_TIMEOUT_MS);
    expect((await call('/games', { cookie: players[0]!.cookie })).json.yourTurn).toEqual([]);
    expect(exists(id)).toBe(false);
  });
});
