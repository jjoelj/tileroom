// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import { LAYOUTS, premiumAt, SIZE } from './board';
import { effectiveDictionary, parseWordList } from './dictionary';
import type { Bag } from './types';
import { BAGS, bagCount, draw, returnToBag, VALUES } from './tiles';

test('bag totals', () => {
  expect(bagCount(BAGS[100])).toBe(100);
  expect(bagCount(BAGS[150])).toBe(150);
  expect(Object.keys(VALUES)).toHaveLength(27);
});

test('both layouts are symmetric on both axes', () => {
  for (const layout of LAYOUTS)
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        expect(premiumAt(layout, r, c)).toBe(premiumAt(layout, SIZE - 1 - r, c));
        expect(premiumAt(layout, r, c)).toBe(premiumAt(layout, r, SIZE - 1 - c));
      }
  expect(premiumAt('special', 7, 7)).toBe('*');
  expect(premiumAt('special', 0, 3)).toBe('T');
});

test('classic layout: the standard counts, and a double-word start square', () => {
  const count: Record<string, number> = {};
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) count[premiumAt('classic', r, c)] = (count[premiumAt('classic', r, c)] ?? 0) + 1;
  expect(count).toMatchObject({ T: 8, D: 16, '+': 1, t: 12, d: 24 });
  expect(premiumAt('classic', 7, 7)).toBe('+');
  expect(premiumAt('classic', 0, 0)).toBe('T');
  expect(premiumAt('classic', 1, 1)).toBe('D');
  expect(premiumAt('classic', 1, 5)).toBe('t');
  expect(premiumAt('classic', 0, 3)).toBe('d');
});

test('draw takes what is there and stops when empty', () => {
  const bag: Bag = { A: 1, B: 2 };
  expect(draw(bag, 5, randomInt).sort()).toEqual(['A', 'B', 'B']);
  expect(bag).toEqual({});
  returnToBag(bag, ['Q', 'Q']);
  expect(bag).toEqual({ Q: 2 });
});

test('draws are uniform over the remaining multiset', () => {
  const N = 60_000;
  const seen: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const [l] = draw({ A: 1, B: 2, C: 3 }, 1, randomInt);
    seen[l!] = (seen[l!] ?? 0) + 1;
  }
  // chi-square, 2 degrees of freedom; 13.8 is p = 0.001
  const chi = [1, 2, 3].reduce((a, k, i) => {
    const e = (N * k) / 6;
    return a + (seen['ABC'[i]!]! - e) ** 2 / e;
  }, 0);
  expect(chi).toBeLessThan(13.8);
});

test('effective dictionary = base ∪ add − ban', () => {
  const base = parseWordList('cat\r\nDOG\nx\nnot-a-word\n');
  expect([...base].sort()).toEqual(['CAT', 'DOG']);
  const isWord = effectiveDictionary([base], { add: ['RIZZ'], ban: ['DOG'] });
  expect(isWord('CAT')).toBe(true);
  expect(isWord('RIZZ')).toBe(true);
  expect(isWord('DOG')).toBe(false);
  expect(isWord('cat')).toBe(false);
  expect(effectiveDictionary([base])('DOG')).toBe(true);
  const expanded = effectiveDictionary([base, new Set(['FAQ', 'DOG'])], { add: [], ban: ['DOG'] });
  expect(expanded('FAQ')).toBe(true);
  expect(expanded('DOG')).toBe(false); // a ban wins over every base list
  expect(effectiveDictionary([base])('FAQ')).toBe(false);
});
