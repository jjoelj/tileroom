// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'bun:test';
import { emptyBoard } from './board';
import { previewPlay } from './rules';
import type { IsWord } from './dictionary';
import type { Board, Placement } from './types';

const any = () => true;
// The scores below were worked out on the special board.
const play = (b: Board, t: Placement[], isWord: IsWord) => previewPlay(b, t, isWord, 'special');

/** Lays `word` on the board as already-played tiles. */
function lay(board: Board, r: number, c: number, word: string, dir: 'across' | 'down' = 'across') {
  [...word].forEach((letter, i) => {
    board[dir === 'down' ? r + i : r]![dir === 'across' ? c + i : c] = { letter, blank: false, seat: 0, turn: 0 };
  });
  return board;
}

/** Placements for `word`; lowercase letters are blanks. */
const tiles = (r: number, c: number, word: string, dir: 'across' | 'down' = 'across'): Placement[] =>
  [...word].map((l, i) => ({
    r: dir === 'down' ? r + i : r,
    c: dir === 'across' ? c + i : c,
    letter: l.toUpperCase(),
    blank: l !== l.toUpperCase(),
  }));

const reason = (b: Board, t: Placement[]) => {
  const p = play(b, t, any);
  return p.ok ? null : p.reason;
};

describe('placement', () => {
  test('first move must cover the center', () => {
    expect(reason(emptyBoard(), tiles(0, 0, 'CAT'))).toBe('The first word must cover the center square');
    expect(reason(emptyBoard(), tiles(7, 6, 'CAT'))).toBeNull();
  });

  test('a single tile on the first move is rejected', () => {
    expect(reason(emptyBoard(), tiles(7, 7, 'A'))).toBe('The first word needs at least 2 tiles');
  });

  test('a gap not filled by existing tiles is rejected; one filled by them is fine', () => {
    expect(reason(emptyBoard(), [...tiles(7, 6, 'C'), ...tiles(7, 8, 'T')])).toBe("Tiles can't have gaps");
    const b = lay(emptyBoard(), 7, 7, 'A');
    expect(reason(b, [...tiles(7, 6, 'C'), ...tiles(7, 8, 'T')])).toBeNull();
    expect(reason(b, [...tiles(6, 7, 'C'), ...tiles(9, 7, 'T')])).toBe("Tiles can't have gaps");
  });

  test('tiles must be in one line', () => {
    expect(reason(emptyBoard(), [...tiles(7, 7, 'A'), ...tiles(8, 8, 'B')])).toBe('Tiles must be in one line');
  });

  test('later moves must connect', () => {
    const b = lay(emptyBoard(), 7, 6, 'CAT');
    expect(reason(b, tiles(0, 0, 'NO'))).toBe('Tiles must connect to the board');
    expect(reason(b, tiles(8, 6, 'AT'))).toBeNull();
  });

  test('bad input', () => {
    const b = lay(emptyBoard(), 7, 6, 'CAT');
    expect(reason(b, [])).toBe('Place 1 to 7 tiles');
    expect(reason(b, tiles(7, 0, 'ABCDEFGH'))).toBe('Place 1 to 7 tiles');
    expect(reason(b, tiles(7, 15, 'A'))).toBe('That square is off the board');
    expect(reason(b, [{ r: 1.5, c: 0, letter: 'A' }])).toBe('That square is off the board');
    expect(reason(b, [{ r: 8, c: 6, letter: '?' }])).toBe('Tiles must be letters A to Z');
    expect(reason(b, tiles(7, 6, 'X'))).toBe('That square is taken');
    expect(reason(b, [...tiles(8, 6, 'X'), ...tiles(8, 6, 'Y')])).toBe('That square is taken');
  });
});

describe('words and scoring', () => {
  test('the main word (listed first) is the one most of the placed tiles went into', () => {
    // SUN goes down from the end of CAT: S also makes CATS, found first, but only SUN holds all 3 new tiles.
    const b = lay(emptyBoard(), 7, 6, 'CAT');
    const p = play(b, tiles(7, 9, 'SUN', 'down'), any);
    expect(p.ok && p.words.map((w) => w.word)).toEqual(['SUN', 'CATS']);
  });

  test('main word ties (one tile, two words) go to the higher score, then the longer word', () => {
    // One S at (8,8): across it makes AS (2), found first; down it makes QS (11). QS leads.
    const b = lay(lay(emptyBoard(), 8, 7, 'A'), 7, 8, 'Q');
    const p = play(b, tiles(8, 8, 'S'), any);
    expect(p.ok && p.words.map((w) => w.word)).toEqual(['QS', 'AS']);
  });

  test('first move, center has no bonus', () => {
    const p = play(emptyBoard(), tiles(7, 6, 'CAT'), any);
    expect(p).toMatchObject({ ok: true, score: 5, words: [{ word: 'CAT', score: 5, r: 7, c: 6, dir: 'across', length: 3 }] });
  });

  test('DW + DW in one word is ×4; TL under a pre-existing tile is ignored', () => {
    const b = lay(emptyBoard(), 3, 7, 'A'); // (3,7) is TL
    const p = play(b, tiles(2, 6, 'COW'), any); // (2,6) and (2,8) are DW
    expect(p.ok && p.words.map((w) => [w.word, w.score])).toEqual([
      ['COW', 32],
      ['OA', 2],
    ]);
    expect(p.ok && p.score).toBe(34);
  });

  test('a blank on TL scores 0 for that letter', () => {
    expect(play(emptyBoard(), tiles(7, 3, 'QUEEN'), any)).toMatchObject({ score: 34 });
    expect(play(emptyBoard(), tiles(7, 3, 'qUEEN'), any)).toMatchObject({ score: 4 });
  });

  test('blanks already on the board stay 0', () => {
    const b = lay(emptyBoard(), 7, 7, 'Q');
    b[7]![7]!.blank = true;
    expect(play(b, tiles(7, 8, 'I'), any)).toMatchObject({ score: 1 });
  });

  test('bonus squares are one-time: J on TL scores 30, later JOT through it counts 10', () => {
    expect(play(lay(emptyBoard(), 5, 6, 'O'), tiles(5, 5, 'J'), any)).toMatchObject({ score: 31 });
    expect(play(lay(emptyBoard(), 5, 5, 'J'), tiles(5, 6, 'OT'), any)).toMatchObject({ score: 12 });
  });

  test('TW', () => {
    const b = lay(emptyBoard(), 0, 0, 'Z'); // (0,3) is TW
    expect(play(b, tiles(0, 1, 'ABC'), any)).toMatchObject({ score: (10 + 1 + 3 + 3) * 3 });
  });

  test('7-tile play adds 40', () => {
    expect(play(emptyBoard(), tiles(7, 4, 'ABCDEFG'), any)).toMatchObject({ score: 16 + 40 });
  });

  test('a single tile forms words both ways', () => {
    const b = lay(lay(emptyBoard(), 7, 6, 'CA'), 5, 8, 'TA', 'down');
    const p = play(b, tiles(7, 8, 'T'), any);
    expect(p.ok && p.words.map((w) => w.word)).toEqual(['CAT', 'TAT']);
  });

  test('an invalid cross-word is named', () => {
    const isWord = (w: string) => w === 'COW';
    const p = play(lay(emptyBoard(), 3, 7, 'A'), tiles(2, 6, 'COW'), isWord);
    expect(p).toMatchObject({ ok: true, invalid: ['OA'] });
  });

  test('score bubble anchors on the bottom-rightmost tile of all words', () => {
    const b = lay(emptyBoard(), 7, 6, 'CAT');
    expect(play(b, tiles(8, 5, 'AT'), any)).toMatchObject({ anchor: { r: 8, c: 6 } });
    expect(play(b, tiles(4, 8, 'BAT', 'down'), any)).toMatchObject({ anchor: { r: 7, c: 8 } });
    expect(play(b, tiles(8, 8, 'O', 'down'), any)).toMatchObject({ anchor: { r: 8, c: 8 } });
  });
});

test('classic board: the start square doubles the first word', () => {
  expect(previewPlay(emptyBoard(), tiles(7, 6, 'CAT'), any, 'classic')).toMatchObject({ score: (3 + 1 + 1) * 2 });
  expect(previewPlay(emptyBoard(), tiles(7, 6, 'CAT'), any, 'special')).toMatchObject({ score: 3 + 1 + 1 });
});
