// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin tools. Admins make as many invites as they like and see who used each one, and see every group with its
// members and how many games it has. Counts only: no boards, racks or moves (no game visibility, SPEC §6.1).
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from './auth';
import { games, groupMembers, groups, invites, users } from './db/schema';
import { ApiError } from './http';
import { db } from './runtime/db';
import { createInvite } from './store';

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user.isAdmin) throw new ApiError(403, 'admin_only');
  await next();
};

const creator = alias(users, 'creator');

export const adminRoutes = new Hono<AppEnv>()
  .post('/admin/invites', (c) => c.json({ code: createInvite(db, c.var.user.id) }, 201))

  .get('/admin/invites', (c) => {
    const rows = db
      .select({
        id: invites.codeHash, // admins only; the code itself is never stored
        hint: invites.codeHint,
        createdAt: invites.createdAt,
        createdBy: creator.displayName, // null: made with the CLI
        usedAt: invites.usedAt,
        usedBy: { username: users.username, displayName: users.displayName },
      })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.usedBy))
      .leftJoin(creator, eq(creator.id, invites.createdBy))
      .orderBy(desc(invites.createdAt))
      .all();
    return c.json({ invites: rows.map((r) => ({ ...r, usedBy: r.usedBy?.username ? r.usedBy : null })) });
  })

  .get('/admin/groups', (c) => {
    const members = db
      .select({ groupId: groupMembers.groupId, username: users.username, displayName: users.displayName, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .orderBy(asc(groupMembers.joinedAt))
      .all();
    const tallies = db
      .select({ groupId: games.groupId, status: games.status, n: count() })
      .from(games)
      .where(isNotNull(games.groupId))
      .groupBy(games.groupId, games.status)
      .all();
    const list = db.select({ id: groups.id, name: groups.name, createdAt: groups.createdAt }).from(groups).orderBy(asc(groups.name)).all();
    return c.json({
      groups: list.map((g) => ({
        ...g,
        members: members.filter((m) => m.groupId === g.id).map(({ groupId, ...m }) => m),
        games: Object.fromEntries((['lobby', 'active', 'finished'] as const).map((s) => [s, tallies.find((t) => t.groupId === g.id && t.status === s)?.n ?? 0])),
      })),
    });
  })

  .delete('/admin/invites/:id', (c) => {
    // Revoking deletes it. Only while unused (used ones stay as the record of who joined), with the same
    // condition signup consumes it with, so the two can't both win.
    const done = db
      .delete(invites)
      .where(and(eq(invites.codeHash, c.req.param('id')), isNull(invites.usedBy)))
      .returning({ id: invites.codeHash })
      .all();
    if (done.length !== 1) throw new ApiError(409, 'not_revocable', 'That invite was already used');
    return c.json({ ok: true });
  });
