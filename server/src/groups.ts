// SPDX-License-Identifier: AGPL-3.0-or-later
// Groups and house words (SPEC §4.10). Words change only through proposals that every current member (or, if the group
// says so, a majority) votes yes on.
import { and, asc, count, desc, eq, inArray, like, lt, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { WORD_RE } from '../../shared/dictionary';
import { tally } from '../../shared/votes';
import type { AppEnv } from './auth';
import { formatGroupCode, formatJoinCode, newGroupCode, normalizeCode, randomId } from './codes';
import { gamePlayers, games, groupMembers, groups, groupWords, proposals, proposalVotes, users } from './db/schema';
import { ApiError, body, rateLimit } from './http';
import { markSeen, notify } from './push';
import { changed, groupChanged, watchingGroup } from './realtime';
import { db, type Tx } from './runtime/db';
import { clientIp } from './runtime/ip';
import { baseWords } from './store';

const DAY = 86_400_000;
const PROPOSAL_DAYS = 7;
const MAX_OPEN_PER_MEMBER = 5;
const MAX_HOUSE_WORDS = 500;

type Q = typeof db | Tx;

// Oldest member first; rowid breaks ties between joins in the same millisecond.
const joinOrder = [asc(groupMembers.joinedAt), sql`${groupMembers}.rowid`] as const;
type Action = 'add' | 'ban' | 'remove' | 'unban';
const VERB: Record<Action, string> = { add: 'adding', ban: 'banning', remove: 'removing', unban: 'unbanning' };

const roleOf = (q: Q, groupId: string, userId: string) =>
  q.select({ role: groupMembers.role }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).get()?.role;

/** The group, if the user is a member; 404 otherwise (non-members don't learn it exists). */
function myGroup(q: Q, groupId: string, userId: string) {
  const g = q.select().from(groups).where(eq(groups.id, groupId)).get();
  const role = g && roleOf(q, groupId, userId);
  if (!g || !role) throw new ApiError(404, 'not_found');
  return { group: g, role };
}

const requireAdmin = (role: string) => {
  if (role !== 'admin') throw new ApiError(403, 'not_admin', 'Only group admins can do that');
};

const memberIds = (q: Q, groupId: string) =>
  q.select({ id: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId)).all().map((m) => m.id);

/** The group's approved words. */
export function approvedWords(q: Q, groupId: string) {
  const rows = q.select({ word: groupWords.word, kind: groupWords.kind }).from(groupWords).where(eq(groupWords.groupId, groupId)).orderBy(asc(groupWords.word)).all();
  return { add: rows.filter((r) => r.kind === 'add').map((r) => r.word), ban: rows.filter((r) => r.kind === 'ban').map((r) => r.word) };
}

const kindOf = (q: Q, groupId: string, word: string) =>
  q.select({ kind: groupWords.kind }).from(groupWords).where(and(eq(groupWords.groupId, groupId), eq(groupWords.word, word))).get()?.kind;

/**
 * Whether `action` on `word` makes sense for the group's list right now. Each word has exactly one way in and out:
 * add/remove for words the base list lacks, ban/unban for base words.
 */
function checkAction(q: Q, groupId: string, word: string, action: Action) {
  const inBase = baseWords().has(word);
  const kind = kindOf(q, groupId, word);
  const bad = (message: string) => new ApiError(409, 'invalid_proposal', message);
  if (action === 'add') {
    if (inBase && kind === 'ban') throw bad(`${word} is banned in this group. Propose unbanning it instead.`);
    if (inBase || kind === 'add') throw bad(`${word} is already a valid word`);
  } else if (action === 'ban') {
    if (kind === 'add') throw bad(`${word} is a house word. Propose removing it instead.`);
    if (!inBase || kind === 'ban') throw bad(`${word} isn't a valid word, so there's nothing to ban`);
  } else if (action === 'remove') {
    if (kind !== 'add') throw bad(`${word} isn't one of this group's added words`);
  } else if (kind !== 'ban') throw bad(`${word} isn't banned in this group`);
}

type Outcome = { id: string; groupId: string; word: string; action: Action; status: 'passed' | 'rejected' | 'expired' };

/** Settles one open proposal if its current members' votes decide it under the group's rule (`tally`). */
function resolve(tx: Tx, proposalId: string, now = Date.now()): Outcome | null {
  const p = tx.select().from(proposals).where(eq(proposals.id, proposalId)).get();
  if (p?.status !== 'open') return null;
  const members = new Set(memberIds(tx, p.groupId));
  const votes = tx.select().from(proposalVotes).where(eq(proposalVotes.proposalId, p.id)).all().filter((v) => members.has(v.userId));
  const { majorityVotes } = tx.select({ majorityVotes: groups.majorityVotes }).from(groups).where(eq(groups.id, p.groupId)).get()!;
  const yes = votes.filter((v) => v.vote === 'yes').length;
  const status = tally(members.size, yes, votes.length - yes, majorityVotes);
  if (!status) return null;
  tx.update(proposals).set({ status, resolvedAt: now }).where(eq(proposals.id, p.id)).run();
  if (status === 'passed') {
    const where = and(eq(groupWords.groupId, p.groupId), eq(groupWords.word, p.word));
    if (p.action === 'add' || p.action === 'ban') tx.insert(groupWords).values({ groupId: p.groupId, word: p.word, kind: p.action, approvedAt: now, proposalId: p.id }).run();
    else tx.delete(groupWords).where(where).run();
  }
  return { id: p.id, groupId: p.groupId, word: p.word, action: p.action, status };
}

/** Membership or the voting rule changed: a joiner now has to vote too; a leaver's missing vote no longer blocks anything. */
function reevaluate(tx: Tx, groupId: string) {
  const open = tx.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.groupId, groupId), eq(proposals.status, 'open'))).all();
  return open.map((p) => resolve(tx, p.id)).filter((o): o is Outcome => !!o);
}


/** A push to these members, except anyone looking at the group's page right now (they see it live). */
function notifyGroup(groupId: string, userIds: string[], body: string) {
  const to = userIds.filter((u) => !watchingGroup(u, groupId));
  void notify(to, { title: groupName(groupId), body, url: `/groups/${groupId}`, tag: `group-${groupId}` });
}

/** A member opened a game in the group: everyone else hears about it while they can still join. */
export function gameOpened(groupId: string, host: { id: string; displayName: string }) {
  const others = memberIds(db, groupId).filter((u) => u !== host.id);
  notifyGroup(groupId, others, `${host.displayName} opened a game. Join before it starts.`);
}

const groupName = (groupId: string) => db.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId)).get()?.name ?? 'Tileroom';

/** Tell every member how a proposal ended; open lobbies in the group show the new words. */
export function announce(outcomes: Outcome[]) {
  for (const groupId of new Set(outcomes.filter((o) => o.status === 'passed').map((o) => o.groupId))) {
    for (const { id } of db.select({ id: games.id }).from(games).where(and(eq(games.groupId, groupId), eq(games.status, 'lobby'))).all()) changed(id);
  }
  for (const o of outcomes) {
    const body =
      o.status === 'passed'
        ? { add: `${o.word} is now a house word`, ban: `${o.word} is now banned`, remove: `${o.word} is no longer a house word`, unban: `${o.word} is allowed again` }[o.action]
        : `${VERB[o.action][0]!.toUpperCase()}${VERB[o.action].slice(1)} ${o.word} ${o.status === 'expired' ? "didn't pass in 7 days" : 'was voted down'}`;
    notifyGroup(o.groupId, memberIds(db, o.groupId), body);
  }
}

const ORPHAN = 'orphaned-';
const hasGames = (q: Q, groupId: string) => !!q.select({ id: games.id }).from(games).where(eq(games.groupId, groupId)).limit(1).get();

/** Removes a group and everything that hangs off it. Only for groups no game points at. */
function deleteGroup(tx: Tx, groupId: string) {
  // children first, explicitly: group_words points at proposals too
  tx.delete(groupWords).where(eq(groupWords.groupId, groupId)).run();
  const ids = tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.groupId, groupId)).all().map((p) => p.id);
  if (ids.length) tx.delete(proposalVotes).where(inArray(proposalVotes.proposalId, ids)).run();
  tx.delete(proposals).where(eq(proposals.groupId, groupId)).run();
  tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId)).run();
  tx.delete(groups).where(eq(groups.id, groupId)).run();
}

/** At startup and every 10 minutes: orphaned groups whose last game is gone (e.g. voided) are deleted. */
export function deleteEmptyOrphans() {
  const orphans = db.select({ id: groups.id }).from(groups).where(like(groups.joinCode, `${ORPHAN}%`)).all();
  for (const { id } of orphans) db.transaction((tx) => !hasGames(tx, id) && deleteGroup(tx, id));
}

/** Every 10 minutes: proposals past their 7 days expire as rejected (SPEC §4.10). */
export function expireProposals(now = Date.now()) {
  const due = db.select().from(proposals).where(and(eq(proposals.status, 'open'), lt(proposals.closesAt, now))).all();
  for (const p of due) db.update(proposals).set({ status: 'expired', resolvedAt: now }).where(eq(proposals.id, p.id)).run();
  for (const groupId of new Set(due.map((p) => p.groupId))) groupChanged(groupId);
  announce(due.map((p) => ({ id: p.id, groupId: p.groupId, word: p.word, action: p.action, status: 'expired' as const })));
}

const GroupName = z.string().trim().min(1).max(30);

const Word = z
  .string()
  .trim()
  .transform((w) => w.toUpperCase())
  .refine((w) => WORD_RE.test(w), 'Words are 2–15 letters, A to Z');

function groupDetail(groupId: string, userId: string) {
  const { group, role } = myGroup(db, groupId, userId);
  const members = db
    .select({ userId: groupMembers.userId, role: groupMembers.role, displayName: users.displayName, colorIndex: users.colorIndex, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(...joinOrder)
    .all();
  const nameOf = (id: string) => db.select({ n: users.displayName }).from(users).where(eq(users.id, id)).get()?.n ?? '';
  const rows = db.select().from(proposals).where(eq(proposals.groupId, groupId)).orderBy(desc(proposals.createdAt)).all();
  const proposal = (p: (typeof rows)[number]) => {
    const votes = db.select().from(proposalVotes).where(eq(proposalVotes.proposalId, p.id)).all();
    return {
      id: p.id,
      word: p.word,
      action: p.action,
      status: p.status,
      proposedBy: nameOf(p.proposedBy),
      createdAt: p.createdAt,
      closesAt: p.closesAt,
      resolvedAt: p.resolvedAt,
      // open: every current member, yes / no / waiting
      votes: members.map((m) => ({ userId: m.userId, displayName: m.displayName, vote: votes.find((v) => v.userId === m.userId)?.vote ?? null })),
    };
  };
  return {
    id: group.id,
    name: group.name,
    joinCode: formatGroupCode(group.joinCode),
    spectatorsSeeRacks: group.spectatorsSeeRacks,
    majorityVotes: group.majorityVotes,
    myRole: role,
    members: members.map((m) => ({ userId: m.userId, displayName: m.displayName, colorIndex: m.colorIndex ?? 0, role: m.role })),
    words: approvedWords(db, groupId),
    proposals: rows.filter((p) => p.status === 'open').map(proposal),
    history: rows.filter((p) => p.status !== 'open').slice(0, 20).map(proposal),
    ...groupGames(groupId, userId),
  };
}

function joinTarget(code: string, ip: string) {
  rateLimit(`join:${ip}`, 20);
  const c = normalizeCode(code);
  const g = c.length === 8 && db.select().from(groups).where(eq(groups.joinCode, c)).get();
  if (!g) throw new ApiError(404, 'not_found', 'No group with that code');
  return g;
}

/** Takes a member out of a group; returns how any open votes ended now that they're gone (for `announce`). */
export function leaveGroup(tx: Tx, groupId: string, uid: string) {
  tx.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, uid))).run();
  // the group always keeps an admin: the longest-standing member takes over
  const hasAdmin = tx.select({ n: count() }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin'))).get()!.n;
  if (!hasAdmin) {
    const next = tx.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId)).orderBy(...joinOrder).limit(1).get();
    if (next) tx.update(groupMembers).set({ role: 'admin' }).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, next.userId))).run();
    // Nobody left: delete it, or if games still point at it (for the group's name), orphan it. Joins only
    // accept 8-character codes, so the orphan token can never be typed.
    else if (!hasGames(tx, groupId)) deleteGroup(tx, groupId);
    else tx.update(groups).set({ joinCode: `${ORPHAN}${randomId()}` }).where(eq(groups.id, groupId)).run();
  }
  return reevaluate(tx, groupId);
}

export const groupRoutes = new Hono<AppEnv>()
  .get('/groups', (c) => {
    const uid = c.var.user.id;
    const mine = db
      .select({ id: groups.id, name: groups.name, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, uid))
      .orderBy(asc(groups.name))
      .all();
    return c.json({
      groups: mine.map((g) => {
        const open = db.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.groupId, g.id), eq(proposals.status, 'open'))).all();
        const voted = open.length
          ? db.select({ id: proposalVotes.proposalId }).from(proposalVotes).where(and(eq(proposalVotes.userId, uid), inArray(proposalVotes.proposalId, open.map((p) => p.id)))).all().length
          : 0;
        return {
          id: g.id,
          name: g.name,
          role: g.role,
          memberCount: db.select({ n: count() }).from(groupMembers).where(eq(groupMembers.groupId, g.id)).get()!.n,
          wordCount: db.select({ n: count() }).from(groupWords).where(eq(groupWords.groupId, g.id)).get()!.n,
          pendingVotes: open.length - voted,
        };
      }),
    });
  })

  .post('/groups', async (c) => {
    const { name } = await body(c, z.object({ name: GroupName }));
    const id = randomId();
    db.transaction((tx) => {
      let joinCode = newGroupCode();
      while (tx.select({ id: groups.id }).from(groups).where(eq(groups.joinCode, joinCode)).get()) joinCode = newGroupCode();
      tx.insert(groups).values({ id, name, createdBy: c.var.user.id, joinCode }).run();
      tx.insert(groupMembers).values({ groupId: id, userId: c.var.user.id, role: 'admin' }).run();
    });
    return c.json(groupDetail(id, c.var.user.id), 201);
  })

  .get('/groups/join/:code', (c) => {
    const g = joinTarget(c.req.param('code'), clientIp(c));
    const members = db
      .select({ name: users.displayName })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, g.id))
      .orderBy(...joinOrder)
      .all();
    return c.json({ id: g.id, name: g.name, members: members.map((m) => m.name), joined: !!roleOf(db, g.id, c.var.user.id) });
  })

  .post('/groups/join/:code', (c) => {
    const g = joinTarget(c.req.param('code'), clientIp(c));
    const uid = c.var.user.id;
    const outcomes = db.transaction((tx) => {
      if (roleOf(tx, g.id, uid)) return [];
      tx.insert(groupMembers).values({ groupId: g.id, userId: uid }).run();
      return reevaluate(tx, g.id);
    });
    announce(outcomes);
    groupChanged(g.id);
    return c.json(groupDetail(g.id, uid));
  })

  .get('/groups/:id', (c) => {
    const detail = groupDetail(c.req.param('id'), c.var.user.id);
    markSeen(c.var.user.id, `group-${c.req.param('id')}`);
    return c.json(detail);
  })

  .get('/groups/:id/past', (c) => {
    const { group } = myGroup(db, c.req.param('id'), c.var.user.id);
    const at = Number(c.req.query('at'));
    const id = c.req.query('id') ?? '';
    if (!Number.isFinite(at) || !id) throw new ApiError(400, 'invalid_cursor');
    return c.json(pastGames(group.id, c.var.user.id, PAST_MORE, { at, id }));
  })

  .post('/groups/:id/code', (c) => {
    const { group, role } = myGroup(db, c.req.param('id'), c.var.user.id);
    requireAdmin(role);
    let joinCode = newGroupCode();
    while (db.select({ id: groups.id }).from(groups).where(eq(groups.joinCode, joinCode)).get()) joinCode = newGroupCode();
    db.update(groups).set({ joinCode }).where(eq(groups.id, group.id)).run();
    groupChanged(group.id);
    return c.json(groupDetail(group.id, c.var.user.id));
  })

  .patch('/groups/:id/settings', async (c) => {
    const { group, role } = myGroup(db, c.req.param('id'), c.var.user.id);
    requireAdmin(role);
    const b = await body(c, z.object({ spectatorsSeeRacks: z.boolean().optional(), majorityVotes: z.boolean().optional(), name: GroupName.optional() }));
    const outcomes: Outcome[] = [];
    const running = db.transaction((tx) => {
      tx.update(groups).set(b).where(eq(groups.id, group.id)).run();
      // a new voting rule applies to open proposals too: some may pass (majority) or fail (unanimous) at once
      if (b.majorityVotes !== undefined) outcomes.push(...reevaluate(tx, group.id));
      const ids = tx.select({ id: games.id }).from(games).where(and(eq(games.groupId, group.id), ne(games.status, 'finished'))).all().map((g) => g.id);
      // Turning trays off applies at once (trays only ever become more private); turning on only to later games (SPEC §4.11).
      if (b.spectatorsSeeRacks === false && ids.length) tx.update(games).set({ spectatorRacks: false }).where(inArray(games.id, ids)).run();
      return ids;
    });
    for (const id of running) changed(id); // fresh views: tray visibility, the group's name
    announce(outcomes);
    groupChanged(group.id);
    return c.json(groupDetail(group.id, c.var.user.id));
  })

  .put('/groups/:id/members/:userId/role', async (c) => {
    const { group, role } = myGroup(db, c.req.param('id'), c.var.user.id);
    requireAdmin(role);
    const { role: next } = await body(c, z.object({ role: z.enum(['admin', 'member']) }));
    const target = c.req.param('userId');
    db.transaction((tx) => {
      if (!roleOf(tx, group.id, target)) throw new ApiError(404, 'not_found');
      const admins = tx.select({ n: count() }).from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.role, 'admin'))).get()!.n;
      if (next === 'member' && roleOf(tx, group.id, target) === 'admin' && admins <= 1) throw new ApiError(409, 'last_admin', 'A group needs at least one admin');
      tx.update(groupMembers).set({ role: next }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, target))).run();
    });
    groupChanged(group.id);
    return c.json(groupDetail(group.id, c.var.user.id));
  })

  .delete('/groups/:id/members/me', (c) => {
    const { group } = myGroup(db, c.req.param('id'), c.var.user.id);
    const outcomes = db.transaction((tx) => leaveGroup(tx, group.id, c.var.user.id));
    announce(outcomes);
    groupChanged(group.id); // the members who stay
    return c.json({ ok: true });
  })

  .delete('/groups/:id', (c) => {
    const { group, role } = myGroup(db, c.req.param('id'), c.var.user.id);
    requireAdmin(role);
    const members = memberIds(db, group.id);
    db.transaction((tx) => {
      // a group game shows the group's name, so groups with games stay
      if (hasGames(tx, group.id)) throw new ApiError(409, 'group_has_games', 'Only a group with no games can be deleted');
      deleteGroup(tx, group.id);
    });
    groupChanged(group.id, members); // open group screens find it gone; games lists drop it
    return c.json({ ok: true });
  })

  .get('/groups/:id/words/:word', (c) => {
    const { group } = myGroup(db, c.req.param('id'), c.var.user.id);
    const word = c.req.param('word').toUpperCase();
    if (!WORD_RE.test(word)) throw new ApiError(400, 'invalid_word', 'Words are 2–15 letters, A to Z');
    const open = db
      .select({ id: proposals.id, action: proposals.action })
      .from(proposals)
      .where(and(eq(proposals.groupId, group.id), eq(proposals.word, word), eq(proposals.status, 'open')))
      .get();
    return c.json({ word, inBase: baseWords().has(word), approved: kindOf(db, group.id, word) ?? null, openProposal: open ?? null });
  })

  .post('/groups/:id/proposals', async (c) => {
    const uid = c.var.user.id;
    const { group } = myGroup(db, c.req.param('id'), uid);
    const { word, action } = await body(c, z.object({ word: Word, action: z.enum(['add', 'ban', 'remove', 'unban']) }));
    const now = Date.now();
    const id = randomId();
    const outcome = db.transaction((tx) => {
      checkAction(tx, group.id, word, action);
      const openOf = (extra: ReturnType<typeof eq>) =>
        tx.select({ n: count() }).from(proposals).where(and(eq(proposals.groupId, group.id), eq(proposals.status, 'open'), extra)).get()!.n;
      if (openOf(eq(proposals.word, word))) throw new ApiError(409, 'already_proposed', `There's already an open proposal for ${word}`);
      if (openOf(eq(proposals.proposedBy, uid)) >= MAX_OPEN_PER_MEMBER) {
        throw new ApiError(409, 'too_many_proposals', `You can have ${MAX_OPEN_PER_MEMBER} open proposals at a time`);
      }
      if (action === 'add' || action === 'ban') {
        const approved = tx.select({ n: count() }).from(groupWords).where(eq(groupWords.groupId, group.id)).get()!.n;
        const pending = openOf(inArray(proposals.action, ['add', 'ban']));
        if (approved + pending >= MAX_HOUSE_WORDS) throw new ApiError(409, 'word_list_full', `A group can have ${MAX_HOUSE_WORDS} house words`);
      }
      tx.insert(proposals).values({ id, groupId: group.id, word, action, proposedBy: uid, createdAt: now, closesAt: now + PROPOSAL_DAYS * DAY }).run();
      tx.insert(proposalVotes).values({ proposalId: id, userId: uid, vote: 'yes', votedAt: now }).run(); // the proposer's yes
      return resolve(tx, id, now); // a group of one decides alone
    });
    if (outcome) announce([outcome]);
    else {
      const others = memberIds(db, group.id).filter((m) => m !== uid);
      notifyGroup(group.id, others, `${c.var.user.displayName} proposed ${VERB[action]} ${word}. Vote now.`);
    }
    groupChanged(group.id);
    return c.json(groupDetail(group.id, uid), 201);
  })

  .post('/proposals/:id/vote', async (c) => {
    const uid = c.var.user.id;
    const { vote } = await body(c, z.object({ vote: z.enum(['yes', 'no']) }));
    const p = db.select().from(proposals).where(eq(proposals.id, c.req.param('id'))).get();
    if (!p || !roleOf(db, p.groupId, uid)) throw new ApiError(404, 'not_found');
    const outcome = db.transaction((tx) => {
      const fresh = tx.select().from(proposals).where(eq(proposals.id, p.id)).get()!;
      if (fresh.status !== 'open') throw new ApiError(409, 'proposal_closed', 'Voting on this has ended');
      tx.insert(proposalVotes)
        .values({ proposalId: p.id, userId: uid, vote })
        .onConflictDoUpdate({ target: [proposalVotes.proposalId, proposalVotes.userId], set: { vote, votedAt: Date.now() } })
        .run();
      return resolve(tx, p.id);
    });
    if (outcome) announce([outcome]);
    groupChanged(p.groupId);
    return c.json(groupDetail(p.groupId, uid));
  });

const PAST_PAGE = 10; // finished games on the group screen; Show more loads 20 at a time
const PAST_MORE = 20;

/** Players, and whether I'm in it, for each game row. */
function withSeats(rows: (typeof games.$inferSelect)[], userId: string) {
  return rows.map((g) => {
    const seats = db
      .select({ userId: gamePlayers.userId, displayName: users.displayName, score: gamePlayers.score, seat: gamePlayers.seat })
      .from(gamePlayers)
      .innerJoin(users, eq(users.id, gamePlayers.userId))
      .where(eq(gamePlayers.gameId, g.id))
      .orderBy(asc(gamePlayers.seat))
      .all();
    return {
      id: g.id,
      status: g.status,
      currentSeat: g.currentSeat,
      turnStartedAt: g.turnStartedAt,
      finishedAt: g.finishedAt,
      players: seats,
      mine: seats.some((s) => s.userId === userId),
      joinCode: g.status === 'lobby' ? formatJoinCode(g.joinCode) : null, // members may join any group lobby
    };
  });
}

/** Finished games, newest first, after the cursor (the last one shown: its finish time, then id for ties). */
function pastGames(groupId: string, userId: string, limit: number, after?: { at: number; id: string }) {
  const cursor = after ? or(lt(games.finishedAt, after.at), and(eq(games.finishedAt, after.at), lt(games.id, after.id))) : undefined;
  const rows = db
    .select()
    .from(games)
    .where(and(eq(games.groupId, groupId), eq(games.status, 'finished'), cursor))
    .orderBy(desc(games.finishedAt), desc(games.id))
    .limit(limit + 1) // one extra says whether there are more
    .all();
  return { games: withSeats(rows.slice(0, limit), userId), more: rows.length > limit };
}

/** Group games for the group screen: every one still going, and the latest finished ones (more on request). */
export function groupGames(groupId: string, userId: string) {
  const going = db.select().from(games).where(and(eq(games.groupId, groupId), ne(games.status, 'finished'))).orderBy(desc(games.createdAt)).all();
  const past = pastGames(groupId, userId, PAST_PAGE);
  return { games: [...withSeats(going, userId), ...past.games], morePast: past.more };
}
