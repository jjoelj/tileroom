// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import { premiumAt, SIZE } from './board';
import { effectiveDictionary, parseWordList } from './dictionary';
import type { Bag } from './types';
import { BAGS, bagCount, draw, returnToBag, VALUES } from './tiles';

test('bag totals', () => {
  expect(bagCount(BAGS[100])).toBe(100);
  expect(bagCount(BAGS[150])).toBe(150);
  expect(Object.keys(VALUES)).toHaveLength(27);
});

test('premium layout is symmetric on both axes', () => {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      expect(premiumAt(r, c)).toBe(premiumAt(SIZE - 1 - r, c));
      expect(premiumAt(r, c)).toBe(premiumAt(r, SIZE - 1 - c));
    }
  expect(premiumAt(7, 7)).toBe('*');
  expect(premiumAt(0, 3)).toBe('T');
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
  const isWord = effectiveDictionary(base, { add: ['RIZZ'], ban: ['DOG'] });
  expect(isWord('CAT')).toBe(true);
  expect(isWord('RIZZ')).toBe(true);
  expect(isWord('DOG')).toBe(false);
  expect(isWord('cat')).toBe(false);
  expect(effectiveDictionary(base)('DOG')).toBe(true);
});
