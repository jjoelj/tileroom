// SPDX-License-Identifier: AGPL-3.0-or-later
// Nightly backups (deploy/README.md): one consistent copy per day in server/data/backups, the last `keepDays` kept.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { vacuumInto } from './runtime/db';

export function backup(dir: string, keepDays = 14, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const file = join(dir, `tileroom-${day(now)}.db`);
  rmSync(file, { force: true }); // VACUUM INTO won't overwrite; a second run today replaces today's copy
  vacuumInto(file);
  const oldest = day(new Date(now.getTime() - keepDays * 86_400_000));
  for (const f of readdirSync(dir)) {
    const m = f.match(/^tileroom-(\d{4}-\d{2}-\d{2})\.db$/);
    if (m && m[1]! <= oldest) rmSync(join(dir, f));
  }
  return file;
}
