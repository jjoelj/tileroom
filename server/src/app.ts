// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from 'hono';
import { type AppEnv, auth, checkOrigin, loadSession, requireUser } from './auth';
import { gameRoutes } from './games';
import { groupRoutes } from './groups';
import { ApiError } from './http';
import { push, requirePush } from './push';

const api = new Hono<AppEnv>()
  .use(checkOrigin, loadSession)
  .route('/', auth)
  .use('/push/*', requireUser)
  .route('/', push)
  .use('/games/*', requireUser, requirePush)
  .use('/games', requireUser, requirePush)
  .use('/join/*', requireUser, requirePush)
  .route('/', gameRoutes)
  .use('/groups', requireUser)
  .use('/groups/*', requireUser)
  .use('/proposals/*', requireUser)
  .route('/', groupRoutes);

export const app = new Hono()
  .route('/api', api)
  .onError((e, c) => {
    if (e instanceof ApiError) return c.json({ error: e.code, ...(e.message !== e.code && { message: e.message }) }, e.status);
    console.error(e instanceof Error ? e.stack : e); // never request bodies (SPEC §10)
    return c.json({ error: 'server_error' }, 500);
  });
