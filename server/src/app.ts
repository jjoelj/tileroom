// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from 'hono';
import { accountRoutes } from './account';
import { adminRoutes, requireAdmin } from './admin';
import { type AppEnv, auth, checkOrigin, loadSession, requireUser } from './auth';
import { gameRoutes } from './games';
import { leaderboardRoutes } from './leaderboard';
import { groupRoutes } from './groups';
import { ApiError } from './http';
import { push, requirePush } from './push';

/** The only routes a signed-out client may call. Everything else needs a session (default deny). */
export const PUBLIC = new Set(['POST /api/auth/login', 'POST /api/auth/signup', 'POST /api/auth/logout', 'POST /api/invites/check']);

const api = new Hono<AppEnv>()
  .use(checkOrigin, loadSession)
  .use((c, next) => (PUBLIC.has(`${c.req.method} ${c.req.path}`) ? next() : requireUser(c, next)))
  .route('/', auth)
  .route('/', accountRoutes)
  .route('/', push)
  .use('/games/*', requirePush)
  .use('/games', requirePush)
  .use('/join/*', requirePush)
  .route('/', gameRoutes)
  .route('/', groupRoutes)
  .route('/', leaderboardRoutes)
  .use('/admin/*', requireAdmin)
  .route('/', adminRoutes);

export const app = new Hono()
  .route('/api', api)
  .onError((e, c) => {
    if (e instanceof ApiError) return c.json({ error: e.code, ...(e.message !== e.code && { message: e.message }) }, e.status);
    console.error(e instanceof Error ? e.stack : e); // never request bodies (SPEC §10)
    return c.json({ error: 'server_error' }, 500);
  });
