// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Board } from './types';

export const SIZE = 15;
export const CENTER = 7;

// . normal  d double letter  t triple letter  D double word  T triple word  * center (no bonus)
const LAYOUT = [
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
];

export type Premium = '.' | 'd' | 't' | 'D' | 'T' | '*';

export const premiumAt = (r: number, c: number) => LAYOUT[r]![c] as Premium;

export const emptyBoard = (): Board => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

export const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
