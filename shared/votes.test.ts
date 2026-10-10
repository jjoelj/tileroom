// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { tally } from './votes';

test('unanimous: all yes passes, one no rejects', () => {
  expect(tally(1, 1, 0, false)).toBe('passed');
  expect(tally(3, 2, 0, false)).toBe(null);
  expect(tally(3, 3, 0, false)).toBe('passed');
  expect(tally(3, 2, 1, false)).toBe('rejected');
  expect(tally(0, 0, 0, false)).toBe(null);
});

test('majority: more than half yes passes; half no rejects', () => {
  expect(tally(1, 1, 0, true)).toBe('passed');
  expect(tally(2, 1, 0, true)).toBe(null); // half isn't a majority
  expect(tally(2, 2, 0, true)).toBe('passed');
  expect(tally(2, 1, 1, true)).toBe('rejected');
  expect(tally(3, 2, 0, true)).toBe('passed');
  expect(tally(3, 2, 1, true)).toBe('passed');
  expect(tally(3, 1, 1, true)).toBe(null);
  expect(tally(4, 2, 1, true)).toBe(null);
  expect(tally(4, 2, 2, true)).toBe('rejected');
  expect(tally(5, 1, 2, true)).toBe(null);
  expect(tally(5, 1, 3, true)).toBe('rejected');
  expect(tally(0, 0, 0, true)).toBe(null);
});
