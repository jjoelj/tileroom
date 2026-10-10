// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { CENTER, emptyBoard, SIZE } from './board';
import { applyMove, newGame, RuleError, TURN_TIMEOUT_MS, turnExpired, winnerSeats } from './rules';
import { BAGS, bagCount } from './tiles';
import type { Bag, GameState, Move } from './types';

const any = () => true;
const first = () => 0; // deterministic draws: always the first letter in the bag

/** Players with the given racks, CENTER already holding an A so single-tile plays connect. */
function game(racks: string[], bag: Bag = {}): GameState {
  const board = emptyBoard();
  board[CENTER]![CENTER] = { letter: 'A', blank: false, seat: 0, turn: 0 };
  return {
    status: 'active',
    layout: 'special', // the scores below were worked out on it
    board,
    bag,
    players: racks.map((r) => ({ rack: [...r], score: 0 })),
    turnNumber: 1,
    currentSeat: 0,
    scorelessStreak: 0,
    finalRoundAfter: null,
  };
}

const play = (letter: string, r: number, c: number, blank = false): Move => ({ type: 'play', tiles: [{ r, c, letter, blank }] });
const pass: Move = { type: 'pass' };
const move = (s: GameState, seat: number, m: Move) => applyMove(s, seat, m, any, first).state;
const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    return (e as Error).message;
  }
  throw new Error('expected a RuleError');
};

describe('newGame', () => {
  test.each([2, 3, 4, 5, 6])('%i players draw 7 each', (n) => {
    const s = newGame(n, 100, 'default', first);
    expect(s.players.map((p) => p.rack.length)).toEqual(Array(n).fill(7));
    expect(bagCount(s.bag)).toBe(100 - 7 * n);
    expect(BAGS[100].A).toBe(9); // the template isn't mutated
  });

  test('rejects 1 or 7 players', () => {
    expect(err(() => newGame(1, 100, 'default', first))).toBe('A game has 2 to 6 players');
    expect(err(() => newGame(7, 150, 'default', first))).toBe('A game has 2 to 6 players');
  });
});

describe('play', () => {
  test('places tiles, scores, refills, records drawn tiles privately', () => {
    const before = game(['ZQ', 'B'], { E: 3 });
    const { state, record } = applyMove(before, 0, { type: 'play', tiles: [{ r: 7, c: 8, letter: 'Z' }] }, any, first);
    expect(state.board[7]![8]).toEqual({ letter: 'Z', blank: false, seat: 0, turn: 1 });
    expect(state.players[0]).toEqual({ rack: ['Q', 'E', 'E', 'E'], score: 11 });
    expect(state.bag).toEqual({});
    expect(state.turnNumber).toBe(2);
    expect(state.currentSeat).toBe(1);
    expect(record).toEqual({
      seat: 0,
      turn: 1,
      type: 'play',
      score: 11,
      tiles: [{ r: 7, c: 8, letter: 'Z', blank: false }],
      words: [{ word: 'AZ', score: 11 }],
      private: { drawn: ['E', 'E', 'E'] },
    });
    expect(before.players[0]!.rack).toEqual(['Z', 'Q']); // input untouched
  });

  test('blanks come from the ? tile', () => {
    const s = move(game(['?', 'B']), 0, play('X', 7, 8, true));
    expect(s.board[7]![8]).toMatchObject({ letter: 'X', blank: true });
    expect(s.players[0]!.score).toBe(1);
    expect(err(() => move(game(['X', 'B']), 0, play('X', 7, 8, true)))).toBe("You don't have a blank");
  });

  test('letters must be in your rack', () => {
    expect(err(() => move(game(['AB', 'C']), 0, play('R', 7, 8)))).toBe("You don't have an R");
    expect(err(() => move(game(['AB', 'C']), 0, play('Q', 7, 8)))).toBe("You don't have a Q");
  });

  test('illegal or invalid plays are rejected and change nothing', () => {
    const s = game(['AB', 'C']);
    expect(err(() => move(s, 0, play('A', 0, 0)))).toBe('Tiles must connect to the board');
    const strict = (w: string) => w === 'AA';
    expect(err(() => applyMove(s, 0, play('B', 7, 8), strict, first))).toBe("AB isn't in this game's word list");
    expect(err(() => applyMove(s, 0, play('B', 7, 6), () => false, first))).toBe("BA isn't in this game's word list");
    expect(s.turnNumber).toBe(1);
  });

  test('names every invalid word', () => {
    const s = game(['AB', 'C']);
    s.board[6]![8] = { letter: 'Q', blank: false, seat: 0, turn: 0 };
    expect(err(() => applyMove(s, 0, play('B', 7, 8), () => false, first))).toBe("QB, AB aren't in this game's word list") // main word first;
  });

  test("only on your turn, only while active, only if you're seated", () => {
    const s = game(['A', 'B']);
    expect(err(() => move(s, 1, pass))).toBe("It's not your turn");
    expect(err(() => move(s, 2, pass))).toBe("You're not playing in this game");
    expect(err(() => move({ ...s, status: 'finished' }, 0, pass))).toBe('This game is over');
  });
});

describe('swap', () => {
  test('swaps tiles, records only the count publicly', () => {
    const { state, record } = applyMove(game(['QU', 'B'], { E: 2 }), 0, { type: 'swap', swap: ['Q'] }, any, first);
    expect(state.players[0]!.rack).toEqual(['U', 'E']);
    expect(state.bag).toEqual({ E: 1, Q: 1 });
    expect(record).toEqual({ seat: 0, turn: 1, type: 'swap', score: 0, swappedCount: 1, private: { swapped: ['Q'], drawn: ['E'] } });
  });

  test('needs at least as many tiles in the bag as you swap', () => {
    expect(err(() => move(game(['QU', 'B'], { E: 1 }), 0, { type: 'swap', swap: ['Q', 'U'] }))).toBe('The bag only has 1 left');
    expect(err(() => move(game(['QU', 'B'], { E: 9 }), 0, { type: 'swap', swap: [] }))).toBe('Swap 1 to 7 tiles');
    expect(err(() => move(game(['QU', 'B'], { E: 9 }), 0, { type: 'swap', swap: ['Z'] }))).toBe("You don't have a Z");
  });
});

describe('game end', () => {
  test.each([2, 3, 6])('stalemate after 2 × %i scoreless turns', (n) => {
    let s = game(Array(n).fill('AB'), { E: 50 });
    for (let i = 0; i < 2 * n - 1; i++) s = move(s, s.currentSeat, i % 2 ? pass : { type: 'swap', swap: [s.players[s.currentSeat]!.rack[0]!] });
    expect(s.status).toBe('active');
    expect(s.scorelessStreak).toBe(2 * n - 1);
    s = move(s, s.currentSeat, pass);
    expect(s.status).toBe('finished');
  });

  test('a scoring play resets the streak', () => {
    let s = move(game(['B', 'B', 'B']), 0, pass);
    s = move(s, 1, play('B', 7, 8));
    expect(s.scorelessStreak).toBe(0);
  });

  test.each([2, 3, 6])('with %i players the bag-emptying move gives everyone exactly one more turn', (n) => {
    const mover = 1;
    let s = game(Array(n).fill('BCD'), { E: 1 });
    s.currentSeat = mover;
    s = move(s, mover, play('B', 7, 8));
    expect(s.finalRoundAfter).toBe(mover);
    const turns: number[] = [];
    while (s.status === 'active') {
      turns.push(s.currentSeat);
      s = move(s, s.currentSeat, pass);
    }
    expect(turns).toEqual(Array.from({ length: n }, (_, i) => (mover + 1 + i) % n));
  });

  test('empty racks are skipped in the final round, including the one that ends it', () => {
    let s = game(['B', 'C', 'D'], { E: 0 });
    s.bag = { E: 1 };
    s.players[0]!.rack = ['B']; // seat 0 plays B, draws the last E
    s = move(s, 0, play('B', 7, 8));
    s.players[1]!.rack = [];
    expect(s.currentSeat).toBe(1); // skip happens on the next advance
    s = move(s, 1, pass);
    expect(s.currentSeat).toBe(2);
    s.players[0]!.rack = [];
    s = move(s, 2, pass);
    expect(s.status).toBe('finished'); // seat 0's last turn was skipped
  });

  test("the final round ends right after the bag-emptier's extra turn", () => {
    let s = game(['BC', 'D'], { E: 1 });
    s = move(s, 0, play('B', 7, 8));
    s = move(s, 1, { type: 'pass' });
    expect(s.finalRoundAfter).toBe(0);
    s = move(s, 0, play('C', 7, 9));
    expect(s.status).toBe('finished');
  });

  test('a turn left for 7 days expires', () => {
    expect(turnExpired(0, TURN_TIMEOUT_MS - 1)).toBe(false);
    expect(turnExpired(0, TURN_TIMEOUT_MS)).toBe(true);
  });

  test('ties share the win', () => {
    expect(winnerSeats([10, 5, 10])).toEqual([0, 2]);
  });
});

/** Tiles in the bag, racks and on the board, with blanks as '?'. */
function census(s: GameState) {
  const all = [
    ...Object.entries(s.bag).flatMap(([l, k]) => Array(k).fill(l)),
    ...s.players.flatMap((p) => p.rack),
    ...s.board.flat().flatMap((t) => (t ? [t.blank ? '?' : t.letter] : [])),
  ];
  return all.sort().join('');
}

test('property: random games conserve tiles, follow the final round, and always end', () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 6 }), fc.constantFrom(100 as const, 150 as const), fc.infiniteStream(fc.nat()), (n, size, rand) => {
      const it = rand[Symbol.iterator]();
      const r = (max: number) => it.next().value % max;
      const full = Object.entries(BAGS[size]).flatMap(([l, k]) => Array(k).fill(l)).sort().join('');
      let s = newGame(n, size, 'default', r);
      let turnsAfterFinal = 0;
      for (let i = 0; i < 2000 && s.status === 'active'; i++) {
        const seat = s.currentSeat;
        const p = s.players[seat]!;
        const roll = r(100);
        let m: Move = pass;
        if (roll < 10 && bagCount(s.bag) > 0 && p.rack.length) m = { type: 'swap', swap: p.rack.slice(0, 1 + r(Math.min(p.rack.length, bagCount(s.bag)))) };
        else if (roll < 95 && p.rack.length >= 2) m = randomPlay(s, p.rack, r);
        const wasFinal = s.finalRoundAfter !== null;
        s = applyMove(s, seat, m, any, r).state;
        if (wasFinal) turnsAfterFinal++;
        expect(census(s)).toBe(full);
        expect(turnsAfterFinal).toBeLessThanOrEqual(n);
      }
      expect(s.status).toBe('finished');
    }),
    { numRuns: 60 },
  );
});

/** Two tiles across the center on an empty board, else one tile next to a random placed tile. */
function randomPlay(s: GameState, rack: string[], r: (max: number) => number): Move {
  const tile = (i: number, row: number, c: number) => ({ r: row, c, letter: rack[i] === '?' ? 'E' : rack[i]!, blank: rack[i] === '?' });
  const filled = s.board.flatMap((row, i) => row.flatMap((t, c) => (t ? [[i, c] as const] : [])));
  if (!filled.length) return { type: 'play', tiles: [tile(0, CENTER, CENTER), tile(1, CENTER, CENTER + 1)] };
  for (let tries = 0; tries < 20; tries++) {
    const [fr, fcol] = filled[r(filled.length)]!;
    const [dr, dc] = [[-1, 0], [1, 0], [0, -1], [0, 1]][r(4)]!;
    const [tr, tc] = [fr + dr!, fcol + dc!];
    if (tr >= 0 && tr < SIZE && tc >= 0 && tc < SIZE && !s.board[tr]![tc]) return { type: 'play', tiles: [tile(r(rack.length), tr, tc)] };
  }
  return pass;
}
