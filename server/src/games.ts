// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { names } from '../../shared/plural';
import { CHOICES } from '../../shared/board';
import { applyMove, MAX_PLAYERS, newGame, RuleError, TURN_TIMEOUT_MS } from '../../shared/rules';
import type { AppEnv } from './auth';
import { newJoinCode, normalizeCode, randomId } from './codes';
import { gamePlayers, games, gameWords, groups, moves, users } from './db/schema';
import { ApiError, body, rateLimit } from './http';
import { approvedWords, deleteEmptyOrphans, expireProposals, gameOpened } from './groups';
import { markSeen, notify } from './push';
import { changed, gone, groupChanged, viewOf, watching } from './realtime';
import { db, type Db, type Tx } from './runtime/db';
import { clientIp } from './runtime/ip';
import { dictionary, isExpired, isMember, loadGame, type LoadedGame, stateOf, voidGame } from './store';
import { toLogMove } from './view';

const DAY = 86_400_000;

const seatOf = (g: LoadedGame, userId: string) => g.seats.find((s) => s.userId === userId)?.seat;

/**
 * Deletes a game (canceled, or voided by the turn timeout) and, once the transaction it's in has finished, tells
 * whoever has it open or listed (realtime `gone`).
 */
function cancel(q: Db | Tx, g: LoadedGame) {
  voidGame(q, g.game.id);
  queueMicrotask(() => gone(g)); // after the (synchronous) transaction commits
}

/** The game, if the user is seated in it. Anyone else gets 404, admins included (SPEC §6.1). Voids it if expired. */
function myGame(id: string, userId: string) {
  const g = loadGame(db, id);
  const seat = g && seatOf(g, userId);
  if (!g || seat === undefined) throw new ApiError(404, 'not_found');
  if (isExpired(g.game)) {
    cancel(db, g);
    throw new ApiError(404, 'not_found');
  }
  return { g, seat };
}

/** The game as this user may see it: seated players and, for group games, members watching. 404 for anyone else. */
function visibleGame(id: string, userId: string) {
  const g = loadGame(db, id);
  if (g && isExpired(g.game)) cancel(db, g);
  const view = g && !isExpired(g.game) ? viewOf(g, userId) : null;
  if (!g || !view) throw new ApiError(404, 'not_found');
  return { g, view };
}

/**
 * Takes a player out of a game that hasn't started: seats close up. The host leaving (or the last one out) cancels it,
 * and the others find it gone. Returns true if the game is gone.
 */
export function leaveLobby(tx: Tx, gameId: string, uid: string) {
  const fresh = loadGame(tx, gameId)!;
  const rest = fresh.seats.filter((s) => s.userId !== uid);
  if (!rest.length || fresh.game.hostId === uid) {
    cancel(tx, fresh);
    return true;
  }
  tx.delete(gamePlayers).where(eq(gamePlayers.gameId, gameId)).run();
  tx.insert(gamePlayers)
    .values(rest.map((s, seat) => ({ gameId, seat, userId: s.userId, joinedAt: s.joinedAt })))
    .run();
  return false;
}

/** A fresh view of the game for this user, with who's watching. */
const viewFor = (id: string, userId: string) => viewOf(loadGame(db, id)!, userId)!;

/** What a game is called for one player: everyone else in it ("Sam & Ben"). Games have no names. */
const titleFor = (g: LoadedGame, userId: string) => names(g.seats.filter((s) => s.userId !== userId).map((s) => s.displayName)) || 'Tileroom';

/** A push about a game, to everyone listed who doesn't have that game open right now (they see it live). */
const notifyGame = (g: LoadedGame, userIds: string[], body: string) => {
  for (const u of userIds.filter((u) => !watching(u, g.game.id))) {
    void notify([u], { title: titleFor(g, u), body, url: `/games/${g.game.id}`, tag: `game-${g.game.id}` });
  }
};

/** A game's settings: chosen at New game, changeable by the host until the start, then fixed. */
const Settings = z.object({
  bagSize: z.union([z.literal(100), z.literal(150)]),
  randomOrder: z.boolean(),
  expandedWords: z.boolean(),
  livePlacing: z.boolean(),
  layout: z.enum(CHOICES), // not special: that's only for games started on it
});

const Turn = z.int().nonnegative();
const MoveBody = z.discriminatedUnion('type', [
  z.object({
    turnNumber: Turn,
    type: z.literal('play'),
    tiles: z
      .array(z.object({ r: z.int(), c: z.int(), letter: z.string().regex(/^[A-Z]$/), blank: z.boolean().optional() }))
      .min(1)
      .max(7),
  }),
  z.object({ turnNumber: Turn, type: z.literal('swap'), swap: z.array(z.string().regex(/^[A-Z?]$/)).min(1).max(7) }),
  z.object({ turnNumber: Turn, type: z.literal('pass') }),
]);

function joinTarget(c: { req: { param: (k: 'code') => string } }, ip: string) {
  rateLimit(`join:${ip}`, 20);
  const code = normalizeCode(c.req.param('code'));
  const row = code.length === 6 && db.select({ id: games.id }).from(games).where(eq(games.joinCode, code)).get();
  if (!row) throw new ApiError(404, 'not_found', 'No game with that code');
  return loadGame(db, row.id)!;
}

export const gameRoutes = new Hono<AppEnv>()
  .get('/games', (c) => {
    const uid = c.var.user.id;
    const mine = db.select({ id: gamePlayers.gameId }).from(gamePlayers).where(eq(gamePlayers.userId, uid)).all();
    const out = { yourTurn: [] as unknown[], waiting: [] as unknown[], lobby: [] as unknown[], finished: [] as unknown[] };
    // ponytail: one query per game; friends have a handful of games
    for (const { id } of mine) {
      const g = loadGame(db, id)!;
      if (isExpired(g.game)) {
        cancel(db, g);
        continue;
      }
      const mySeat = seatOf(g, uid)!;
      const { game } = g;
      const summary = {
        id,
        status: game.status,
        currentSeat: game.currentSeat,
        turnStartedAt: game.turnStartedAt,
        finishedAt: game.finishedAt,
        mySeat,
        group: g.group,
        players: g.seats.map((s) => ({ seat: s.seat, displayName: s.displayName, score: s.score, colorIndex: s.colorIndex ?? s.seat })), // colors as in the game
      };
      if (game.status === 'lobby') out.lobby.push(summary);
      else if (game.status === 'finished') out.finished.push(summary);
      else (game.currentSeat === mySeat ? out.yourTurn : out.waiting).push(summary);
    }
    out.finished = (out.finished as { finishedAt: number }[]).sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 20);
    return c.json(out);
  })

  .post('/games', async (c) => {
    const b = await body(
      c,
      // the defaults: a game starts with them and the host changes any in the lobby
      Settings.extend({
        bagSize: Settings.shape.bagSize.default(100),
        randomOrder: z.boolean().default(true),
        expandedWords: z.boolean().default(false),
        livePlacing: z.boolean().default(true),
        layout: z.enum(CHOICES).default('default'),
        groupId: z.string().max(64).optional(), // a group game: that group's words, its members only
      }),
    );
    if (b.groupId && !isMember(db, b.groupId, c.var.user.id)) throw new ApiError(404, 'not_found');
    const id = randomId();
    db.transaction((tx) => {
      let joinCode = newJoinCode();
      while (tx.select({ id: games.id }).from(games).where(eq(games.joinCode, joinCode)).get()) joinCode = newJoinCode();
      // Anyone can join up to MAX_PLAYERS; the host starts whenever 2+ have joined.
      tx.insert(games).values({ id, ...b, hostId: c.var.user.id, joinCode }).run();
      tx.insert(gamePlayers).values({ gameId: id, seat: 0, userId: c.var.user.id }).run();
    });
    changed(id); // open group pages list it right away
    if (b.groupId) gameOpened(b.groupId, c.var.user);
    return c.json(viewFor(id, c.var.user.id), 201);
  })

  .get('/join/:code', (c) => {
    const g = joinTarget(c, clientIp(c));
    const host = g.seats.find((s) => s.userId === g.game.hostId);
    return c.json({
      id: g.game.id,
      status: g.game.status,
      hostName: host?.displayName ?? null,
      players: g.seats.map((s) => s.displayName),
      joined: seatOf(g, c.var.user.id) !== undefined,
      group: g.group,
      // a group game takes only that group's members (SPEC §4.10)
      canJoin: !g.group || isMember(db, g.group.id, c.var.user.id),
    });
  })

  .post('/join/:code', (c) => {
    const g = joinTarget(c, clientIp(c));
    const uid = c.var.user.id;
    const existing = seatOf(g, uid);
    if (existing !== undefined) return c.json(viewFor(g.game.id, uid));
    if (g.game.status !== 'lobby') throw new ApiError(409, 'already_started', 'This game has already started');
    if (g.group && !isMember(db, g.group.id, uid)) throw new ApiError(403, 'not_group_member', `This game is for ${g.group.name}. Join the group first.`);
    db.transaction((tx) => {
      const fresh = loadGame(tx, g.game.id)!;
      if (fresh.seats.length >= MAX_PLAYERS) throw new ApiError(409, 'game_full', 'This game is full');
      tx.insert(gamePlayers).values({ gameId: g.game.id, seat: fresh.seats.length, userId: uid }).run();
    });
    changed(g.game.id);
    notifyGame(loadGame(db, g.game.id)!, [g.game.hostId], `${c.var.user.displayName} joined your game`);
    return c.json(viewFor(g.game.id, c.var.user.id));
  })

  .get('/games/:id', (c) => {
    const { view } = visibleGame(c.req.param('id'), c.var.user.id);
    markSeen(c.var.user.id, `game-${view.id}`); // on screen: its notifications on other devices can go
    return c.json(view);
  })

  .patch('/games/:id', async (c) => {
    const { g } = myGame(c.req.param('id'), c.var.user.id);
    const b = await body(c, Settings.partial());
    if (g.game.hostId !== c.var.user.id) throw new ApiError(403, 'not_host');
    if (g.game.status !== 'lobby') throw new ApiError(409, 'already_started');
    db.update(games).set(b).where(eq(games.id, g.game.id)).run();
    changed(g.game.id);
    return c.json(viewFor(g.game.id, c.var.user.id));
  })

  // Leave a game before it starts. Seats close up (they're join order); the host leaving cancels it, and so does
  // the last one out.
  .delete('/games/:id/players/me', (c) => {
    const { g } = myGame(c.req.param('id'), c.var.user.id);
    if (g.game.status !== 'lobby') throw new ApiError(409, 'already_started', "The game has started, so it can't be left");
    const gone = db.transaction((tx) => leaveLobby(tx, g.game.id, c.var.user.id));
    if (!gone) changed(g.game.id);
    if (g.group) groupChanged(g.group.id);
    return c.json({ ok: true });
  })

  .post('/games/:id/start', (c) => {
    const { g } = myGame(c.req.param('id'), c.var.user.id);
    const { game } = g;
    if (game.hostId !== c.var.user.id) throw new ApiError(403, 'not_host');
    if (game.status !== 'lobby') throw new ApiError(409, 'already_started');
    if (g.seats.length < 2) throw new ApiError(409, 'not_enough_players', 'Wait for at least one more player');
    const order = [...g.seats];
    if (game.randomOrder) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
    }
    const state = newGame(order.length, game.bagSize, game.layout, randomInt);
    const now = Date.now();
    db.transaction((tx) => {
      tx.delete(gamePlayers).where(eq(gamePlayers.gameId, game.id)).run();
      tx.insert(gamePlayers)
        .values(order.map((s, seat) => ({ gameId: game.id, seat, userId: s.userId, joinedAt: s.joinedAt, rack: state.players[seat]!.rack })))
        .run();
      tx.update(games)
        .set({
          status: 'active',
          startedAt: now,
          turnStartedAt: now,
          board: state.board,
          bag: state.bag,
          turnNumber: state.turnNumber,
          currentSeat: state.currentSeat,
        })
        .where(eq(games.id, game.id))
        .run();
      if (game.groupId) {
        // Freeze the group's words and tray setting: later votes and "on" switches don't touch this game (SPEC §4.10, §4.11).
        const words = approvedWords(tx, game.groupId);
        const rows = [...words.add.map((word) => ({ word, kind: 'add' as const })), ...words.ban.map((word) => ({ word, kind: 'ban' as const }))];
        if (rows.length) tx.insert(gameWords).values(rows.map((r) => ({ gameId: game.id, ...r }))).run();
        const group = tx.select({ racks: groups.spectatorsSeeRacks }).from(groups).where(eq(groups.id, game.groupId)).get();
        tx.update(games).set({ spectatorRacks: !!group?.racks }).where(eq(games.id, game.id)).run();
      }
    });
    // only whoever goes first hears about it: everyone else gets their turn's push when it comes
    notifyGame(g, [order[state.currentSeat]!.userId], 'Your turn. The game has started.');
    changed(game.id);
    return c.json(viewFor(game.id, c.var.user.id));
  })

  .post('/games/:id/moves', async (c) => {
    const id = c.req.param('id');
    const uid = c.var.user.id;
    const { turnNumber, ...move } = await body(c, MoveBody);
    const result = db.transaction((tx) => {
      const g = loadGame(tx, id);
      const seat = g && seatOf(g, uid);
      if (!g || seat === undefined) throw new ApiError(404, 'not_found');
      if (g.game.status !== 'active') throw new ApiError(409, 'game_not_active');
      if (isExpired(g.game)) {
        cancel(tx, g); // committed: the game is gone either way
        return null;
      }
      if (turnNumber !== g.game.turnNumber) throw new ApiError(409, 'stale_turn', 'The game moved on. Reload to see the latest.');
      if (g.game.currentSeat !== seat) throw new ApiError(409, 'not_your_turn', "It's not your turn");
      let applied: ReturnType<typeof applyMove>;
      try {
        applied = applyMove(stateOf(g), seat, move, dictionary(g.game, g.house), randomInt);
      } catch (e) {
        if (e instanceof RuleError) throw new ApiError(400, 'invalid_move', e.message);
        throw e;
      }
      const { state, record } = applied;
      const now = Date.now();
      tx.update(games)
        .set({
          status: state.status,
          finishedAt: state.status === 'finished' ? now : null,
          board: state.board,
          bag: state.bag,
          turnNumber: state.turnNumber,
          currentSeat: state.currentSeat,
          scorelessStreak: state.scorelessStreak,
          finalRoundAfter: state.finalRoundAfter,
          turnStartedAt: now,
          reminderSent: false,
        })
        .where(eq(games.id, id))
        .run();
      const mine = state.players[seat]!;
      tx.update(gamePlayers).set({ rack: mine.rack, score: mine.score }).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.seat, seat))).run();
      tx.insert(moves)
        .values({
          gameId: id,
          turnNumber: record.turn,
          seat,
          type: record.type,
          tiles: record.tiles ?? null,
          words: record.words ?? null,
          score: record.score,
          swappedCount: record.swappedCount ?? null,
          private: record.private ?? null,
        })
        .run();
      return { g, seat, state, record };
    });
    if (!result) throw new ApiError(410, 'game_expired', 'This game was cancelled after 7 days without a move');

    const { g, seat, state, record } = result;
    const mover = g.seats[seat]!.displayName;
    changed(id);
    if (state.status === 'finished') {
      notifyGame(g, g.seats.filter((s) => s.seat !== seat).map((s) => s.userId), 'Game over. See who won.');
    } else {
      const did =
        record.type === 'play' ? `${mover} played ${record.words![0]!.word} (${record.score})` : record.type === 'swap' ? `${mover} swapped tiles` : `${mover} passed`;
      notifyGame(g, [g.seats[state.currentSeat]!.userId], `Your turn. ${did}`);
    }
    return c.json(viewFor(id, uid));
  })

  .get('/games/:id/log', (c) => {
    const { g, view } = visibleGame(c.req.param('id'), c.var.user.id);
    const rows = db.select().from(moves).where(eq(moves.gameId, g.game.id)).orderBy(desc(moves.id)).all();
    // spectators (no seat) get the public log only
    return c.json({ moves: rows.map((m) => toLogMove(m, view.mySeat ?? -1)) });
  })

  .post('/games/:id/nudge', (c) => {
    const { g, seat } = myGame(c.req.param('id'), c.var.user.id);
    if (g.game.status !== 'active') throw new ApiError(409, 'game_not_active');
    if (g.game.currentSeat === seat) throw new ApiError(409, 'your_turn', "It's your turn");
    if (g.seats[g.game.currentSeat]!.deleted) throw new ApiError(409, 'player_deleted', 'That account was deleted. The game ends after 7 days without a move.');
    const me = g.seats[seat]!;
    const now = Date.now();
    // once a day per turn per game: a nudge from an earlier turn doesn't count
    const thisTurn = me.lastNudgeAt !== null && me.lastNudgeAt >= (g.game.turnStartedAt ?? 0);
    if (thisTurn && now - me.lastNudgeAt! < DAY) throw new ApiError(429, 'nudge_limited', 'You can nudge once a day per turn');
    db.update(gamePlayers).set({ lastNudgeAt: now }).where(and(eq(gamePlayers.gameId, g.game.id), eq(gamePlayers.seat, seat))).run();
    notifyGame(g, [g.seats[g.game.currentSeat]!.userId], `${me.displayName} nudged you: it's your turn`);
    return c.json({ ok: true });
  });

/** Every 10 minutes: void games past the 7-day turn timeout, send 1-day-left reminders (SPEC §4.8). */
export async function runJobs(now = Date.now()) {
  expireProposals(now);
  deleteEmptyOrphans();
  // ponytail: scans every active game; fine at friends scale, add an index on turn_started_at if it grows
  const active = db.select().from(games).where(eq(games.status, 'active')).orderBy(asc(games.turnStartedAt)).all();
  for (const game of active) {
    if (isExpired(game, now)) {
      cancel(db, loadGame(db, game.id)!);
      continue;
    }
    if (game.reminderSent || game.turnStartedAt === null || now - game.turnStartedAt < TURN_TIMEOUT_MS - DAY) continue;
    db.update(games).set({ reminderSent: true }).where(eq(games.id, game.id)).run();
    const current = db
      .select({ id: users.id, remindTurn: users.remindTurn })
      .from(gamePlayers)
      .innerJoin(users, eq(users.id, gamePlayers.userId))
      .where(and(eq(gamePlayers.gameId, game.id), eq(gamePlayers.seat, game.currentSeat)))
      .get();
    if (current?.remindTurn) {
      await notify([current.id], {
        title: titleFor(loadGame(db, game.id)!, current.id),
        body: 'Your turn: 1 day left before the game is cancelled.',
        url: `/games/${game.id}`,
        tag: `game-${game.id}`,
      });
    }
  }
}
