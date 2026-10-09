// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { backup } from './backup';

test('backup writes a readable copy for today and keeps the last keepDays days (here Jan 12 to 25)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tileroom-backup-'));
  for (const d of ['2026-01-01', '2026-01-11', '2026-01-12']) writeFileSync(join(dir, `tileroom-${d}.db`), '');
  writeFileSync(join(dir, 'notes.txt'), ''); // not ours: left alone
  const file = backup(dir, 14, new Date('2026-01-25T03:00:00Z'));
  expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'tileroom-2026-01-12.db', 'tileroom-2026-01-25.db']);
  const copy = new Database(file, { readonly: true });
  expect(copy.query("select count(*) as n from sqlite_master where name = 'users'").get()).toEqual({ n: 1 });
  copy.close();
  backup(dir, 14, new Date('2026-01-25T09:00:00Z')); // same day again: replaced, not an error
});
