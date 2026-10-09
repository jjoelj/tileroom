// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Context, Hono } from 'hono';
import { serveStatic } from 'hono/bun';

const root = './client/dist'; // relative to the working directory: the repo root, or /app in Docker

/** Hashed assets never change; everything else (index.html, sw.js, manifest) must revalidate so installed PWAs update (SPEC §11). */
const cache = (_path: string, c: Context) =>
  c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');

/** Serves the built client, with index.html for any other non-API path (client-side routes). */
export function serveClient(app: Hono) {
  app.use('*', serveStatic({ root, onFound: cache }));
  app.get('*', (c, next) =>
    c.req.path.startsWith('/api/') ? next() : serveStatic({ path: `${root}/index.html`, onFound: cache })(c, next),
  );
}
