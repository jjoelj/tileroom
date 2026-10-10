// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { ago, names, plural, turnAge } from './plural';

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
  expect(ago(-5000)).toBe('just now'); // a clock a little ahead of the server
  expect(ago(59_999)).toBe('just now');
  expect(ago(MIN)).toBe('1 minute ago');
  expect(ago(59 * MIN)).toBe('59 minutes ago');
  expect(ago(60 * MIN)).toBe('1 hour ago');
  expect(ago(23 * 60 * MIN + 59 * MIN)).toBe('23 hours ago');
  expect(ago(24 * 60 * MIN)).toBe('1 day ago');
  expect(ago(6.9 * 24 * 60 * MIN)).toBe('6 days ago');
});

test('turnAge', () => {
  expect(turnAge(0, 0, 2 * 3_600_000)).toBe('started 2 hours ago');
  expect(turnAge(5, 0, 60_000)).toBe('last move 1 minute ago');
});
