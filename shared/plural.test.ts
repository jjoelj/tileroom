// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { names, plural } from './plural';

test('plural', () => {
  expect(plural(1, 'win', 'wins')).toBe('1 win');
  expect(plural(2, 'win', 'wins')).toBe('2 wins');
  expect(plural(0, 'tile left', 'tiles left')).toBe('0 tiles left');
  expect(plural(1, 'person watching', 'people watching')).toBe('1 person watching');
});

test('names', () => {
  expect(names([])).toBe('');
  expect(names(['Sam'])).toBe('Sam');
  expect(names(['Sam', 'Ben'])).toBe('Sam & Ben');
  expect(names(['Sam', 'Ben', 'Ana'])).toBe('Sam, Ben & Ana');
});
