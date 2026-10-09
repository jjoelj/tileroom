// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { asc, desc, eq } from 'drizzle-orm';
import { effectiveDictionary, parseWordList, type IsWord } from '../../shared/dictionary';
import { turnExpired } from '../../shared/rules';
import type { GameState } from '../../shared/types';
import { gamePlayers, games, moves, users } from './db/schema';
import type { Db, Tx } from './runtime/db';

export type GameRow = typeof games.$inferSelect;
export type MoveRow = typeof moves.$inferSelect;
export type Seat = typeof gamePlayers.$inferSelect & { displayName: string; colorIndex: number | null };
export type LoadedGame = { game: GameRow; seats: Seat[] };

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
  return { game, seats };
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

let base: Set<string> | undefined;

/** Base list only until groups land (milestone 5). */
export function dictionary(): IsWord {
  base ??= parseWordList(readFileSync(new URL('../../wordlists/words.txt', import.meta.url), 'utf8'));
  return effectiveDictionary(base);
}
