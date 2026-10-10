// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Board } from './types';

export const SIZE = 15;
export const CENTER = 7;

// . normal  d double letter  t triple letter  D double word  T triple word  * start (no bonus)  + start (double word)
const BOARDS = {
  // the default: bonuses out toward the edges, none on words in the 7×7 middle, a plain start
  default: [
    't..T...d...T..t',
    '.D....t.t....D.',
    '....d.....d....',
    'T..d...D...d..T',
    '..d..t...t..d..',
    '....t..d..t....',
    '.t...........t.',
    'd..D.d.*.d.D..d',
    '.t...........t.',
    '....t..d..t....',
    '..d..t...t..d..',
    'T..d...D...d..T',
    '....d.....d....',
    '.D....t.t....D.',
    't..T...d...T..t',
  ],
  // the long-standing standard: word bonuses near the middle, a double-word start
  classic: [
    'T..d...T...d..T',
    '.D...t...t...D.',
    '..D...d.d...D..',
    'd..D...d...D..d',
    '....D.....D....',
    '.t...t...t...t.',
    '..d...d.d...d..',
    'T..d...+...d..T',
    '..d...d.d...d..',
    '.t...t...t...t.',
    '....D.....D....',
    'd..D...d...D..d',
    '..D...d.d...D..',
    '.D...t...t...D.',
    'T..d...T...d..T',
  ],
  // Tileroom's first board: only for games started on it (New game no longer offers it)
  special: [
    '...T..d.d..T...',
    '.D...t...t...D.',
    '..d...D.D...d..',
    'T..D...t...D..T',
    '....d.....d....',
    '.t...t...t...t.',
    'd.D...d.d...D.d',
    '...t...*...t...',
    'd.D...d.d...D.d',
    '.t...t...t...t.',
    '....d.....d....',
    'T..D...t...D..T',
    '..d...D.D...d..',
    '.D...t...t...D.',
    '...T..d.d..T...',
  ],
} as const;

/** Which premium layout a game is played on, set in its lobby (default unless changed). */
export type Layout = keyof typeof BOARDS;
export const LAYOUTS = Object.keys(BOARDS) as Layout[];
/** The layouts a new game can pick. */
export const CHOICES = ['default', 'classic'] as const satisfies readonly Layout[];

export type Premium = '.' | 'd' | 't' | 'D' | 'T' | '*' | '+';

export const premiumAt = (layout: Layout, r: number, c: number) => BOARDS[layout][r]![c] as Premium;

export const emptyBoard = (): Board => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

export const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
