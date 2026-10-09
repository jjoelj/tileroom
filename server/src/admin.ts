// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin tools. Admins make as many invites as they like and see who used each one. No game visibility (SPEC §6.1).
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './auth';
import { invites, users } from './db/schema';
import { ApiError, body } from './http';
import { db } from './runtime/db';
import { createInvite } from './store';

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user.isAdmin) throw new ApiError(403, 'admin_only');
  await next();
};

const creator = alias(users, 'creator');

export const adminRoutes = new Hono<AppEnv>()
  .post('/admin/invites', async (c) => {
    const { note } = await body(c, z.object({ note: z.string().trim().max(60).optional() }));
    return c.json({ code: createInvite(db, c.var.user.id, note || undefined) }, 201);
  })

  .get('/admin/invites', (c) => {
    const rows = db
      .select({
        hint: invites.codeHint,
        note: invites.note,
        createdAt: invites.createdAt,
        createdBy: creator.displayName, // null: made with the CLI
        usedAt: invites.usedAt,
        revokedAt: invites.revokedAt,
        usedBy: { username: users.username, displayName: users.displayName },
      })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.usedBy))
      .leftJoin(creator, eq(creator.id, invites.createdBy))
      .orderBy(desc(invites.createdAt))
      .all();
    return c.json({ invites: rows.map((r) => ({ ...r, usedBy: r.usedBy?.username ? r.usedBy : null })) });
  });
