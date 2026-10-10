// SPDX-License-Identifier: AGPL-3.0-or-later
// Leaderboards (SPEC §4.12): Wins and Points boards, global and per group, from finished games. Ratings come later
// and add a Rating board. Plain stats, so everyone is listed (no "unranked" rule here).
import { and, desc, eq, max, type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { gamePlayers, games, groupMembers, users } from './db/schema';
import { ApiError } from './http';
import { db } from './runtime/db';
import { isMember } from './store';

export type Standing = { userId: string; displayName: string; games: number; wins: number; points: number; best: number };

const TOP = 100;

/** Finished games only. Global: everyone who hasn't opted out. Group: that group's games, its current members. */
export function standings(groupId: string | null): Standing[] {
  const top = db.select({ gameId: gamePlayers.gameId, score: max(gamePlayers.score).as('top_score') }).from(gamePlayers).groupBy(gamePlayers.gameId).as('top');
  const where: SQL[] = [eq(games.status, 'finished')];
  if (groupId) where.push(eq(games.groupId, groupId));
  else where.push(eq(users.showOnGlobal, true));
  let q = db
    .select({
      userId: gamePlayers.userId,
      displayName: users.displayName,
      games: sql<number>`count(*)`,
      wins: sql<number>`sum(case when ${gamePlayers.score} = ${top.score} then 1 else 0 end)`.as('wins'), // ties count (SPEC §4.12)
      points: sql<number>`sum(${gamePlayers.score})`.as('points'),
      best: sql<number>`max(${gamePlayers.score})`,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(top, eq(top.gameId, gamePlayers.gameId))
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .$dynamic();
  if (groupId) q = q.innerJoin(groupMembers, and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, gamePlayers.userId)));
  // ponytail: computed per request; a few friends' games are cheap. Cache for 60 s (SPEC) if it ever shows up in timings.
  return q.where(and(...where)).groupBy(gamePlayers.userId).orderBy(desc(sql`wins`), desc(sql`points`)).all();
}

export const leaderboardRoutes = new Hono<AppEnv>().get('/leaderboard', (c) => {
  const groupId = c.req.query('group') ?? null;
  if (groupId && !isMember(db, groupId, c.var.user.id)) throw new ApiError(404, 'not_found');
  const all = standings(groupId);
  const rows = all.slice(0, TOP);
  // the viewer's own row, pinned, when they're further down
  const me = rows.some((r) => r.userId === c.var.user.id) ? null : (all.find((r) => r.userId === c.var.user.id) ?? null);
  return c.json({ rows, me });
});
