// SPDX-License-Identifier: AGPL-3.0-or-later

/** A tile on the board. `letter` is what it reads as, even for blanks. */
export type BoardTile = { letter: string; blank: boolean; seat: number; turn: number };
export type Board = (BoardTile | null)[][];

/** Remaining tiles as letter counts; `?` is a blank. No order is ever stored (SPEC §6.1). */
export type Bag = Record<string, number>;

export type Placement = { r: number; c: number; letter: string; blank?: boolean };

export type Move =
  | { type: 'play'; tiles: Placement[] }
  | { type: 'swap'; swap: string[] }
  | { type: 'pass' }
  | { type: 'resign' };

export type PlayerState = { rack: string[]; score: number; resigned: boolean };

/** Server-side state. Never sent to clients as-is; see toView (SPEC §6.1). */
export type GameState = {
  status: 'active' | 'finished';
  board: Board;
  bag: Bag;
  players: PlayerState[]; // index = seat
  turnNumber: number;
  currentSeat: number;
  scorelessStreak: number;
  finalRoundAfter: number | null;
};

export type WordScore = { word: string; score: number };

/** One word formed by a play: where it sits (for the outline overlay) and what it scores. */
export type FormedWord = WordScore & { r: number; c: number; dir: 'across' | 'down'; length: number };

/** What a move did. Everything except `private` is public. */
export type MoveRecord = {
  seat: number;
  turn: number;
  type: Move['type'];
  score: number;
  tiles?: Required<Placement>[];
  words?: WordScore[];
  swappedCount?: number;
  private?: { swapped?: string[]; drawn: string[] };
};

/** Returns a uniform integer in [0, max). The server passes `crypto.randomInt`. */
export type RandomInt = (max: number) => number;
