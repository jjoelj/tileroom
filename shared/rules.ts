// SPDX-License-Identifier: AGPL-3.0-or-later
import { CENTER, type Layout, SIZE, emptyBoard, inBounds, premiumAt } from './board';
import type { IsWord } from './dictionary';
import { BAGS, BLANK, RACK_SIZE, VALUES, bagCount, draw, returnToBag } from './tiles';
import type { Board, FormedWord, GameState, Move, MoveRecord, Placement, RandomInt } from './types';

export const SWEEP_BONUS = 40;
/** A game seats 2 to 6; a lobby stays open up to the maximum until the host starts it. */
export const MAX_PLAYERS = 6;

/** A move the rules don't allow. The message is safe to show the mover (it only mentions their own rack). */
export class RuleError extends Error {}

export type Preview =
  | { ok: false; reason: string }
  | {
      ok: true;
      words: FormedWord[];
      score: number;
      /** Words not in the dictionary; the play is submittable only when this is empty. */
      invalid: string[];
      /** Bottom-rightmost tile among all words formed: where the score bubble goes (SPEC §9.2). */
      anchor: { r: number; c: number };
    };

const DIRS = [
  ['across', 0, 1],
  ['down', 1, 0],
] as const;

/** Checks geometry, finds every word formed and scores them. Used for the live preview and by applyMove. */
export function previewPlay(board: Board, tiles: Placement[], isWord: IsWord, layout: Layout): Preview {
  const fail = (reason: string): Preview => ({ ok: false, reason });
  if (tiles.length < 1 || tiles.length > RACK_SIZE) return fail('Place 1 to 7 tiles');

  const placed = new Map<number, Placement>();
  for (const t of tiles) {
    if (!Number.isInteger(t.r) || !Number.isInteger(t.c) || !inBounds(t.r, t.c)) return fail('That square is off the board');
    if (!/^[A-Z]$/.test(t.letter)) return fail('Tiles must be letters A to Z');
    if (board[t.r]![t.c] || placed.has(t.r * SIZE + t.c)) return fail('That square is taken');
    placed.set(t.r * SIZE + t.c, t);
  }
  const letterAt = (r: number, c: number) =>
    inBounds(r, c) ? (placed.get(r * SIZE + c)?.letter ?? board[r]![c]?.letter) : undefined;

  const rows = new Set(tiles.map((t) => t.r));
  const cols = new Set(tiles.map((t) => t.c));
  if (rows.size > 1 && cols.size > 1) return fail('Tiles must be in one line');
  const [dr, dc] = rows.size === 1 ? [0, 1] : [1, 0];
  const first = tiles.reduce((a, t) => (t.r + t.c < a.r + a.c ? t : a));
  const last = tiles.reduce((a, t) => (t.r + t.c > a.r + a.c ? t : a));
  for (let r = first.r, c = first.c; r <= last.r && c <= last.c; r += dr, c += dc) {
    if (!letterAt(r, c)) return fail("Tiles can't have gaps");
  }

  if (board.every((row) => row.every((x) => !x))) {
    if (!placed.has(CENTER * SIZE + CENTER)) return fail('The first word must cover the center square');
    if (tiles.length < 2) return fail('The first word needs at least 2 tiles');
  } else if (!tiles.some((t) => [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([a, b]) => board[t.r + a!]?.[t.c + b!]))) {
    return fail('Tiles must connect to the board');
  }

  const words: FormedWord[] = [];
  const seen = new Set<string>();
  let anchor = { r: -1, c: -1 };
  for (const t of tiles) {
    for (const [dir, wr, wc] of DIRS) {
      let r = t.r, c = t.c;
      while (letterAt(r - wr, c - wc)) {
        r -= wr;
        c -= wc;
      }
      const key = `${dir}${r},${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = { r, c };
      let word = '', sum = 0, mult = 1, mine = 0;
      for (; letterAt(r, c); r += wr, c += wc) {
        const p = placed.get(r * SIZE + c);
        const b = board[r]![c];
        word += letterAt(r, c);
        let v = (p ? p.blank : b!.blank) ? 0 : VALUES[letterAt(r, c)!]!;
        if (p) {
          mine++;
          const prem = premiumAt(layout, r, c);
          if (prem === 'd') v *= 2;
          if (prem === 't') v *= 3;
          if (prem === 'D' || prem === '+') mult *= 2;
          if (prem === 'T') mult *= 3;
        }
        sum += v;
      }
      if (word.length < 2) continue;
      words.push({ word, score: sum * mult, ...start, dir, length: word.length, placed: mine });
      const end = { r: r - wr, c: c - wc };
      if (end.r > anchor.r || (end.r === anchor.r && end.c > anchor.c)) anchor = end;
    }
  }

  // Main word first ("Sam played SUN"): the one most of the new tiles went into, then the higher score, then the longer.
  words.sort((a, b) => b.placed - a.placed || b.score - a.score || b.length - a.length);
  const score = words.reduce((a, w) => a + w.score, 0) + (tiles.length === RACK_SIZE ? SWEEP_BONUS : 0);
  return { ok: true, words, score, invalid: words.map((w) => w.word).filter((w) => !isWord(w)), anchor };
}

/** Each player draws a full rack. Seat order is decided by the caller. */
export function newGame(seatCount: number, bagSize: 100 | 150, layout: Layout, randomInt: RandomInt): GameState {
  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > MAX_PLAYERS) throw new RuleError('A game has 2 to 6 players');
  const bag = { ...BAGS[bagSize] };
  return {
    status: 'active',
    layout,
    board: emptyBoard(),
    bag,
    players: Array.from({ length: seatCount }, () => ({ rack: draw(bag, RACK_SIZE, randomInt), score: 0 })),
    turnNumber: 0,
    currentSeat: 0,
    scorelessStreak: 0,
    finalRoundAfter: null,
  };
}

function takeFromRack(rack: string[], letters: string[]) {
  const left = [...rack];
  for (const l of letters) {
    const i = left.indexOf(l);
    if (i < 0) throw new RuleError(l === BLANK ? "You don't have a blank" : `You don't have ${/[AEFHILMNORSX]/.test(l) ? 'an' : 'a'} ${l}`);
    left.splice(i, 1);
  }
  return left;
}

/**
 * Hands the turn on after `seat` moved. Ends the game when the final round is over (SPEC §4.8): everyone gets one
 * more turn after the bag empties, the seat that emptied it last. (Nobody can be out of tiles before their turn: every
 * play refills while the bag lasts, the emptier draws the last tiles, and in the final round each plays only once.)
 */
function advance(s: GameState, seat: number, finalRoundJustStarted: boolean) {
  if (s.finalRoundAfter === seat && !finalRoundJustStarted) s.status = 'finished';
  else s.currentSeat = (seat + 1) % s.players.length;
}

/**
 * In the final round (SPEC §4.8, as `advance` plays it): the seats still to play, in order, from whoever's turn it is
 * round to the bag-emptier (each of those turns is their last); everyone else is out of turns. Null before it.
 */
export function finalTurns(playerCount: number, currentSeat: number, finalRoundAfter: number | null): number[] | null {
  if (finalRoundAfter === null) return null;
  const left = [currentSeat];
  while (left.at(-1) !== finalRoundAfter) left.push((left.at(-1)! + 1) % playerCount);
  return left;
}

/** Validates and applies one move. Returns a new state; `state` is not modified. */
export function applyMove(state: GameState, seat: number, move: Move, isWord: IsWord, randomInt: RandomInt) {
  const s = structuredClone(state);
  if (s.status !== 'active') throw new RuleError('This game is over');
  const player = s.players[seat];
  if (!player) throw new RuleError("You're not playing in this game");
  const record: MoveRecord = { seat, turn: s.turnNumber, type: move.type, score: 0 };
  s.turnNumber++;

  if (s.currentSeat !== seat) throw new RuleError("It's not your turn");

  let finalRoundJustStarted = false;
  if (move.type === 'play') {
    const tiles = move.tiles.map((t) => ({ r: t.r, c: t.c, letter: t.letter, blank: t.blank === true }));
    player.rack = takeFromRack(player.rack, tiles.map((t) => (t.blank ? BLANK : t.letter)));
    const p = previewPlay(s.board, tiles, isWord, s.layout);
    if (!p.ok) throw new RuleError(p.reason);
    if (p.invalid.length) throw new RuleError(`${p.invalid.join(', ')} ${p.invalid.length > 1 ? "aren't" : "isn't"} in this game's word list`);
    for (const t of tiles) s.board[t.r]![t.c] = { letter: t.letter, blank: t.blank, seat, turn: record.turn };
    const bagHadTiles = bagCount(s.bag) > 0;
    const drawn = draw(s.bag, RACK_SIZE - player.rack.length, randomInt);
    player.rack.push(...drawn);
    player.score += p.score;
    if (bagHadTiles && bagCount(s.bag) === 0 && s.finalRoundAfter === null) {
      s.finalRoundAfter = seat;
      finalRoundJustStarted = true;
    }
    Object.assign(record, { score: p.score, tiles, words: p.words.map(({ word, score }) => ({ word, score })), private: { drawn } });
  } else if (move.type === 'swap') {
    const n = move.swap.length;
    if (n < 1 || n > RACK_SIZE) throw new RuleError('Swap 1 to 7 tiles');
    player.rack = takeFromRack(player.rack, move.swap);
    if (bagCount(s.bag) < n) throw new RuleError(`The bag only has ${bagCount(s.bag)} left`);
    const drawn = draw(s.bag, n, randomInt);
    returnToBag(s.bag, move.swap);
    player.rack.push(...drawn);
    Object.assign(record, { swappedCount: n, private: { swapped: [...move.swap], drawn } });
  }

  s.scorelessStreak = record.score === 0 ? s.scorelessStreak + 1 : 0;
  if (s.scorelessStreak >= 2 * s.players.length) s.status = 'finished';
  else advance(s, seat, finalRoundJustStarted);
  return { state: s, record };
}

/** Highest score wins; ties share the win. */
export function winnerSeats(scores: number[]) {
  const best = Math.max(...scores);
  return scores.flatMap((score, seat) => (score === best ? [seat] : []));
}

/** A turn left untaken this long voids the whole game (SPEC §4.8). */
export const TURN_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export const turnExpired = (turnStartedAt: number, now: number) => now - turnStartedAt >= TURN_TIMEOUT_MS;
