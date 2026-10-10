// SPDX-License-Identifier: AGPL-3.0-or-later
// Deleting an account. Other players' games and history keep a seat for it, so the account is anonymized rather
// than removed: a "Deleted player" who can't sign in, in no group, on no leaderboard, with no devices or invites.
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { type AppEnv, COOKIE } from './auth';
import { newToken, randomId } from './codes';
import { gamePlayers, games, groupMembers, invites, proposalVotes, pushSubs, sessions, users } from './db/schema';
import { changed, groupChanged, renamed } from './realtime';
import { leaveLobby } from './games';
import { announce, leaveGroup } from './groups';
import { ApiError, body, rateLimit } from './http';
import { db, type Tx } from './runtime/db';
import { hashPassword, verifyPassword } from './runtime/hash';
import { voidGame } from './store';

export const DELETED_NAME = 'Deleted player';

export const accountRoutes = new Hono<AppEnv>().delete('/me', async (c) => {
  const u = c.var.user;
  rateLimit(`delete:${u.id}`, 5);
  const { password } = await body(c, z.object({ password: z.string().max(128) }));
  if (!(await verifyPassword(password, u.passwordHash))) throw new ApiError(400, 'wrong_password', "That isn't your password");
  if (u.isAdmin) throw new ApiError(403, 'admin_cannot_delete', "Admin accounts can't be deleted");
  const unusable = await hashPassword(newToken()); // nobody knows it, and the username is gone too

  const lobbies = db
    .select({ id: games.id, hostId: games.hostId, groupId: games.groupId })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(and(eq(gamePlayers.userId, u.id), eq(games.status, 'lobby')))
    .all();
  const groupIds = db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, u.id)).all().map((g) => g.id);

  const { outcomes, stay } = db.transaction((tx: Tx) => {
    // Games not started: theirs are cancelled (others find them gone); in others' they just leave.
    // Games being played are left alone: they void after 7 days of this seat not moving (SPEC turn timeout).
    const stay: string[] = [];
    for (const g of lobbies) {
      if (g.hostId === u.id) voidGame(tx, g.id);
      else if (!leaveLobby(tx, g.id, u.id)) stay.push(g.id);
    }
    tx.delete(proposalVotes).where(eq(proposalVotes.userId, u.id)).run();
    const outcomes = groupIds.flatMap((gid) => leaveGroup(tx, gid, u.id));
    tx.delete(invites).where(and(eq(invites.createdBy, u.id), isNull(invites.usedBy))).run();
    tx.delete(pushSubs).where(eq(pushSubs.userId, u.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, u.id)).run();
    tx.update(users)
      .set({ username: `deleted-${randomId()}`, displayName: DELETED_NAME, passwordHash: unusable, showOnGlobal: false, remindTurn: false })
      .where(eq(users.id, u.id))
      .run();
    return { outcomes, stay };
  });

  announce(outcomes);
  for (const id of stay) changed(id);
  for (const g of lobbies) if (g.groupId) groupChanged(g.groupId);
  for (const gid of groupIds) groupChanged(gid);
  renamed(u.id, DELETED_NAME); // running games show the new name
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});
