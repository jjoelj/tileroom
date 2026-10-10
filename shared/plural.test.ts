// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { ago, names, plural } from './plural';

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

test('ago', () => {
  const MIN = 60_000;
  expect(ago(-5000)).toBe('now'); // a clock a little ahead of the server
  expect(ago(59_999)).toBe('now');
  expect(ago(MIN)).toBe('1m');
  expect(ago(59 * MIN)).toBe('59m');
  expect(ago(60 * MIN)).toBe('1h');
  expect(ago(23 * 60 * MIN + 59 * MIN)).toBe('23h');
  expect(ago(24 * 60 * MIN)).toBe('1d');
  expect(ago(6.9 * 24 * 60 * MIN)).toBe('6d');
});
