// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { createECDH, randomBytes } from 'node:crypto';
import fc from 'fast-check';
import webpush from 'web-push';
import { CENTER } from '../../shared/board';
import { applyMove, newGame } from '../../shared/rules';
import type { Bag, GameState, Move } from '../../shared/types';
import type { LoadedGame, MoveRow } from './store';
import { toLogMove, toView } from './view';

const any = () => true;

/** A random active game, as the DB would hold it. */
function randomGame(n: number, steps: number, r: (max: number) => number) {
  let s: GameState = newGame(n, 100, 'default', r);
  const rows: MoveRow[] = [];
  for (let i = 0; i < steps && s.status === 'active'; i++) {
    const seat = s.currentSeat;
    const rack = s.players[seat]!.rack;
    const empty = s.board.every((row) => row.every((t) => !t));
    const tile = (k: number, c: number) => ({ r: CENTER, c, letter: rack[k] === '?' ? 'E' : rack[k]!, blank: rack[k] === '?' });
    const m: Move =
      empty && r(2) ? { type: 'play', tiles: [tile(0, CENTER), tile(1, CENTER + 1)] } : r(2) ? { type: 'swap', swap: rack.slice(0, 1 + r(3)) } : { type: 'pass' };
    const { state, record } = applyMove(s, seat, m, any, r);
    s = state;
    rows.push({
      id: i + 1,
      gameId: 'g',
      turnNumber: record.turn,
      seat,
      type: record.type,
      tiles: record.tiles ?? null,
      words: record.words ?? null,
      score: record.score,
      swappedCount: record.swappedCount ?? null,
      private: record.private ?? null,
      createdAt: 0,
    });
  }
  return { s, rows };
}

function loaded(s: GameState): LoadedGame {
  return {
    game: {
      id: 'g',
      hostId: 'u0',
      status: s.status,
      layout: s.layout,
      livePlacing: true,
      bagSize: 100,
      randomOrder: false,
      expandedWords: false,
      groupId: null,
      spectatorRacks: false,
      joinCode: 'ABCDEF',
      createdAt: 0,
      startedAt: 0,
      finishedAt: null,
      board: s.board,
      bag: s.bag,
      turnNumber: s.turnNumber,
      currentSeat: s.currentSeat,
      scorelessStreak: s.scorelessStreak,
      finalRoundAfter: s.finalRoundAfter,
      turnStartedAt: 0,
      reminderSent: false,
    },
    seats: s.players.map((p, seat) => ({
      gameId: 'g',
      seat,
      userId: `u${seat}`,
      displayName: `P${seat}`,
      colorIndex: null,
      deleted: false,
      rack: p.rack,
      score: p.score,
      joinedAt: 0,
      lastNudgeAt: null,
    })),
    group: null,
    house: { add: [], ban: [] },
  };
}

test('indistinguishability: shuffling hidden tiles never changes what a player receives (SPEC §6.1)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc.integer({ min: 0, max: 30 }),
      fc.nat(5),
      fc.infiniteStream(fc.nat()),
      fc.infiniteStream(fc.nat()),
      (n, steps, v, gameRand, hiddenRand) => {
        const g1 = gameRand[Symbol.iterator]();
        const { s, rows } = randomGame(n, steps, (max) => g1.next().value % max);
        fc.pre(s.status === 'active');
        const viewer = v % n;

        // Same public state, different hidden state: pool the other racks and the bag, deal them out again.
        const h = hiddenRand[Symbol.iterator]();
        const rh = (max: number) => h.next().value % max;
        const others = s.players.filter((_, i) => i !== viewer);
        const pool = [...others.flatMap((p) => p.rack), ...Object.entries(s.bag).flatMap(([l, k]) => Array<string>(k).fill(l))];
        for (let i = pool.length - 1; i > 0; i--) {
          const j = rh(i + 1);
          [pool[i], pool[j]] = [pool[j]!, pool[i]!];
        }
        const s2: GameState = structuredClone(s);
        s2.players.forEach((p, i) => {
          if (i !== viewer) p.rack = pool.splice(0, p.rack.length);
        });
        const bag: Bag = {};
        for (const l of pool) bag[l] = (bag[l] ?? 0) + 1;
        s2.bag = bag;
        const rows2 = rows.map((m) =>
          m.seat === viewer || !m.private ? m : { ...m, private: { swapped: m.private.swapped?.map(() => 'Z'), drawn: m.private.drawn.map(() => 'Q') } },
        );

        const last = (rs: MoveRow[]) => rs.at(-1);
        expect(JSON.stringify(toView(loaded(s2), viewer, last(rows2)))).toBe(JSON.stringify(toView(loaded(s), viewer, last(rows))));
        expect(JSON.stringify(rows2.map((m) => toLogMove(m, viewer)))).toBe(JSON.stringify(rows.map((m) => toLogMove(m, viewer))));
      },
    ),
    { numRuns: 300 },
  );
});

test('indistinguishability for spectators without trays: shuffling every hidden tile changes nothing (SPEC §6.1)', () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 0, max: 30 }), fc.infiniteStream(fc.nat()), fc.infiniteStream(fc.nat()), (n, steps, gameRand, hiddenRand) => {
      const g1 = gameRand[Symbol.iterator]();
      const { s, rows } = randomGame(n, steps, (max) => g1.next().value % max);
      fc.pre(s.status === 'active');
      // pool every rack and the bag, deal them out again
      const h = hiddenRand[Symbol.iterator]();
      const pool = [...s.players.flatMap((p) => p.rack), ...Object.entries(s.bag).flatMap(([l, k]) => Array<string>(k).fill(l))];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = h.next().value % (i + 1);
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      const s2: GameState = structuredClone(s);
      for (const p of s2.players) p.rack = pool.splice(0, p.rack.length);
      const bag: Bag = {};
      for (const l of pool) bag[l] = (bag[l] ?? 0) + 1;
      s2.bag = bag;
      const rows2 = rows.map((m) => (m.private ? { ...m, private: { swapped: m.private.swapped?.map(() => 'Z'), drawn: m.private.drawn.map(() => 'Q') } } : m));
      expect(JSON.stringify(toView(loaded(s2), null, rows2.at(-1)))).toBe(JSON.stringify(toView(loaded(s), null, rows.at(-1))));
      expect(JSON.stringify(rows2.map((m) => toLogMove(m, -1)))).toBe(JSON.stringify(rows.map((m) => toLogMove(m, -1))));
    }),
    { numRuns: 200 },
  );
});

test('web-push encrypts under Bun (SPEC §11: verify early)', async () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const sub = { endpoint: 'https://push.test/x', keys: { p256dh: ecdh.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') } };
  const keys = webpush.generateVAPIDKeys();
  const req = webpush.generateRequestDetails(sub, '{"title":"t","body":"b"}', {
    vapidDetails: { subject: 'mailto:test@tileroom.test', publicKey: keys.publicKey, privateKey: keys.privateKey },
  });
  expect(req.headers.Authorization).toStartWith('vapid t=');
  expect(req.headers['Content-Encoding']).toBe('aes128gcm');
  expect((req.body as Buffer).length).toBeGreaterThan(24);
});
