// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate as runMigrations } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '../db/schema';

const dataDir = fileURLToPath(new URL('../../data/', import.meta.url));
if (!process.env.DB_PATH) mkdirSync(dataDir, { recursive: true });
const path = process.env.DB_PATH ?? `${dataDir}tileroom.db`;
const sqlite = new Database(path, { create: true, strict: true });
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const migrate = () => runMigrations(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });

/** A consistent copy of the live database, safe while the app is writing (SQLite's VACUUM INTO). */
export const vacuumInto = (file: string) => sqlite.prepare('VACUUM INTO ?').run(file);
