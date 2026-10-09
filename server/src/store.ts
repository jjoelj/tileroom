// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { and, asc, desc, eq } from 'drizzle-orm';
import { effectiveDictionary, parseWordList, type IsWord } from '../../shared/dictionary';
import { turnExpired } from '../../shared/rules';
import type { GameState } from '../../shared/types';
import { newInviteCode, normalizeCode, sha256 } from './codes';
import { gamePlayers, games, gameWords, groupMembers, groups, invites, moves, users } from './db/schema';
import type { Db, Tx } from './runtime/db';

export type GameRow = typeof games.$inferSelect;
export type MoveRow = typeof moves.$inferSelect;
export type Seat = typeof gamePlayers.$inferSelect & { displayName: string; colorIndex: number | null };
export type HouseWords = { add: string[]; ban: string[] };
/** A game with its players, its group (if any) and its frozen house words. */
export type LoadedGame = { game: GameRow; seats: Seat[]; group: { id: string; name: string } | null; house: HouseWords };

type Q = Db | Tx;

export function loadGame(q: Q, id: string): LoadedGame | undefined {
  const game = q.select().from(games).where(eq(games.id, id)).get();
  if (!game) return undefined;
  const seats = q
    .select()
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, id))
    .orderBy(asc(gamePlayers.seat))
    .all()
    .map((r) => ({ ...r.game_players, displayName: r.users.displayName, colorIndex: r.users.colorIndex }));
  const group = game.groupId ? (q.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.id, game.groupId)).get() ?? null) : null;
  return { game, seats, group, house: houseWordsOf(q, id) };
}

/** The rules-engine state of a started game. */
export function stateOf({ game, seats }: LoadedGame): GameState {
  if (game.status === 'lobby' || !game.board || !game.bag) throw new Error('game not started');
  return {
    status: game.status,
    board: game.board,
    bag: game.bag,
    players: seats.map((s) => ({ rack: s.rack, score: s.score })),
    turnNumber: game.turnNumber,
    currentSeat: game.currentSeat,
    scorelessStreak: game.scorelessStreak,
    finalRoundAfter: game.finalRoundAfter,
  };
}

export const lastMove = (q: Q, gameId: string) =>
  q.select().from(moves).where(eq(moves.gameId, gameId)).orderBy(desc(moves.id)).limit(1).get();

export const isExpired = (game: GameRow, now = Date.now()) =>
  game.status === 'active' && game.turnStartedAt !== null && turnExpired(game.turnStartedAt, now);

/** "As if it never happened" (SPEC §4.8): players and moves go with it via ON DELETE CASCADE. */
export const voidGame = (q: Q, id: string) => q.delete(games).where(eq(games.id, id)).run();

const lists: Record<string, Set<string>> = {};
const load = (name: 'words' | 'abbreviations') =>
  (lists[name] ??= parseWordList(readFileSync(new URL(`../../wordlists/${name}.txt`, import.meta.url), 'utf8')));

/** Makes a single-use invite and returns its code, the only time it exists in the clear (only the hash is stored). */
export function createInvite(q: Q, createdBy: string | null, note?: string) {
  const code = newInviteCode();
  const normalized = normalizeCode(code);
  q.insert(invites).values({ codeHash: sha256(normalized), codeHint: normalized.slice(-4), createdBy, note }).run();
  return code;
}

export const isMember = (q: Q, groupId: string, userId: string) =>
  !!q.select({ u: groupMembers.userId }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).get();

/** A group member who isn't seated in this group game may watch it (SPEC §4.11). Open games can't be watched. */
export const canSpectate = (q: Q, g: LoadedGame, userId: string) =>
  !!g.group && !g.seats.some((s) => s.userId === userId) && isMember(q, g.group.id, userId);

/** The base word list (no abbreviations): what group proposals are checked against. */
export const baseWords = () => load('words');

/** A game's frozen house words (empty for open games and lobbies). */
export function houseWordsOf(q: Q, gameId: string): HouseWords {
  const rows = q.select().from(gameWords).where(eq(gameWords.gameId, gameId)).all();
  const pick = (kind: 'add' | 'ban') => rows.filter((r) => r.kind === kind).map((r) => r.word).sort();
  return { add: pick('add'), ban: pick('ban') };
}

/** The game's dictionary: base words (plus abbreviations if expanded), plus its frozen house adds, minus its bans. */
export function dictionary(game: Pick<GameRow, 'expandedWords'>, house: HouseWords = { add: [], ban: [] }): IsWord {
  return effectiveDictionary(game.expandedWords ? [load('words'), load('abbreviations')] : [load('words')], house);
}
