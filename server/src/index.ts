// SPDX-License-Identifier: AGPL-3.0-or-later
import { app } from './app';
import { runJobs } from './games';
import { pushConfigured } from './push';
import { migrate } from './runtime/db';
import { serve } from './runtime/serve';

if (!pushConfigured) throw new Error('Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (see .env.example)');

migrate();
setInterval(() => void runJobs().catch((e) => console.error('jobs failed', e)), 10 * 60_000);

// Docker sets HOST=0.0.0.0 inside the container; the host port is still bound to 127.0.0.1 (SPEC §11).
const server = serve(app.fetch, Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
console.log(`Tileroom listening on ${server.url}`);
