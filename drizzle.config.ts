// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'drizzle-kit';

export default defineConfig({ dialect: 'sqlite', schema: './server/src/db/schema.ts', out: './server/drizzle' });
