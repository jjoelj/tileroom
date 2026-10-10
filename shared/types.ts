// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Layout } from './board';

/** A tile on the board. `letter` is what it reads as, even for blanks. */
export type BoardTile = { letter: string; blank: boolean; seat: number; turn: number };
export type Board = (BoardTile | null)[][];

/** Remaining tiles as letter counts; `?` is a blank. No order is ever stored (SPEC §6.1). */
export type Bag = Record<string, number>;

export type Placement = { r: number; c: number; letter: string; blank?: boolean };

export type Move =
  | { type: 'play'; tiles: Placement[] }
  | { type: 'swap'; swap: string[] }
  | { type: 'pass' };

export type PlayerState = { rack: string[]; score: number };

/** Server-side state. Never sent to clients as-is; see toView (SPEC §6.1). */
export type GameState = {
  status: 'active' | 'finished';
  layout: Layout;
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
/** `placed`: how many of this move's new tiles are in it (picks the main word). */
export type FormedWord = WordScore & { r: number; c: number; dir: 'across' | 'down'; length: number; placed: number };

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

// ---- Wire types (SPEC §6). Built only by server/src/view.ts. ----

export type PublicMove =
  | { seat: number; turn: number; type: 'play'; tiles: Required<Placement>[]; words: WordScore[]; score: number }
  | { seat: number; turn: number; type: 'swap'; count: number }
  | { seat: number; turn: number; type: 'pass' };

/** A move in the log; `private` is present only on the requester's own moves. */
export type LogMove = PublicMove & { private?: MoveRecord['private'] };

export type GameView = {
  id: string;
  status: 'lobby' | 'active' | 'finished';
  hostUserId: string;
  /** Only while in the lobby, for sharing. */
  joinCode: string | null;
  bagSize: 100 | 150;
  randomOrder: boolean;
  layout: Layout;
  /** Abbreviations (FAQ, DIY…) are valid too (SPEC §4.9). */
  expandedWords: boolean;
  turnNumber: number;
  currentSeat: number;
  /** When the current turn began; the game is voided 7 days later (SPEC §4.8). */
  turnStartedAt: number | null;
  bagCount: number;
  board: (BoardTile | null)[][];
  /** `here`: that player has this game open and in front right now (presence, from the socket). */
  players: { seat: number; userId: string; displayName: string; colorIndex: number; score: number; rackCount: number; here: boolean; deleted: boolean }[];
  role: 'player' | 'spectator';
  mySeat: number | null;
  myRack: string[] | null;
  spectatorRacks: { seat: number; rack: string[] }[] | null;
  spectatorsSeeRacks: boolean;
  watching: { userId: string; displayName: string }[];
  /** The group a group game belongs to; null for open games. */
  group: { id: string; name: string } | null;
  /** The group's words, frozen when the game started (empty for open games and lobbies). */
  houseWords: { add: string[]; ban: string[] };
  lastMove: PublicMove | null;
  finalRoundAfter: number | null;
  finalRacks?: { seat: number; rack: string[] }[];
  winnerSeats?: number[];
};
