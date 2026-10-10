// SPDX-License-Identifier: AGPL-3.0-or-later
// Leaderboards (SPEC §4.12): Wins and Points boards, global and per group, from finished games. Ratings come later
// and add a Rating board. Plain stats, so everyone is listed (no "unranked" rule), with 0s until they finish a game.
import { and, desc, eq, max, or, type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { gamePlayers, games, groupMembers, users } from './db/schema';
import { ApiError } from './http';
import { db } from './runtime/db';
import { isMember } from './store';

export type Standing = { userId: string; displayName: string; games: number; wins: number; points: number; best: number; listed: boolean };

const TOP = 100;

/**
 * Global: everyone who hasn't opted out, plus the viewer either way (unlisted if opted out, so they can see where
 * they'd be). Group: its current members, counting only its games. Sorted by wins, then points.
 */
export function standings(groupId: string | null, viewerId: string): Standing[] {
  const top = db.select({ gameId: gamePlayers.gameId, score: max(gamePlayers.score).as('top_score') }).from(gamePlayers).groupBy(gamePlayers.gameId).as('top');
  const finished: SQL[] = [eq(games.status, 'finished')];
  if (groupId) finished.push(eq(games.groupId, groupId));
  const stats = db
    .select({
      userId: gamePlayers.userId,
      games: sql<number>`count(*)`.as('games'),
      wins: sql<number>`sum(case when ${gamePlayers.score} = ${top.score} then 1 else 0 end)`.as('wins'), // ties count (SPEC §4.12)
      // Special games count for wins but not points: its bonuses sit close together and inflate scores
      points: sql<number>`sum(case when ${games.layout} = 'special' then 0 else ${gamePlayers.score} end)`.as('points'),
      best: sql<number>`max(case when ${games.layout} = 'special' then 0 else ${gamePlayers.score} end)`.as('best'),
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(top, eq(top.gameId, gamePlayers.gameId))
    .where(and(...finished))
    .groupBy(gamePlayers.userId)
    .as('stats');
  const fields = {
    userId: users.id,
    displayName: users.displayName,
    games: sql<number>`coalesce(${stats.games}, 0)`,
    wins: sql<number>`coalesce(${stats.wins}, 0)`.as('w'),
    points: sql<number>`coalesce(${stats.points}, 0)`.as('p'),
    best: sql<number>`coalesce(${stats.best}, 0)`,
    listed: groupId ? sql<number>`1` : sql<number>`${users.showOnGlobal}`,
  };
  const q = groupId
    ? db.select(fields).from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId)).leftJoin(stats, eq(stats.userId, users.id)).where(eq(groupMembers.groupId, groupId))
    : db.select(fields).from(users).leftJoin(stats, eq(stats.userId, users.id)).where(or(eq(users.showOnGlobal, true), eq(users.id, viewerId)));
  // ponytail: computed per request; a few friends' games are cheap. Cache for 60 s (SPEC) if it ever shows up in timings.
  return q.orderBy(desc(sql`w`), desc(sql`p`)).all().map((r) => ({ ...r, listed: !!r.listed }));
}

export const leaderboardRoutes = new Hono<AppEnv>().get('/leaderboard', (c) => {
  const uid = c.var.user.id;
  const groupId = c.req.query('group') ?? null;
  if (groupId && !isMember(db, groupId, uid)) throw new ApiError(404, 'not_found');
  const all = standings(groupId, uid);
  // `me`: the viewer's own row, always, even when opted out of the global board (only they see it, in their place).
  return c.json({ rows: all.filter((r) => r.listed).slice(0, TOP), me: all.find((r) => r.userId === uid) ?? null });
});
