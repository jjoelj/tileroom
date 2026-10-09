// SPDX-License-Identifier: AGPL-3.0-or-later
// The ONLY path from server state to the wire (SPEC §6.1). Explicit allowlists: never spread rows or state.
import { emptyBoard } from '../../shared/board';
import { winnerSeats } from '../../shared/rules';
import { bagCount } from '../../shared/tiles';
import type { GameView, LogMove, PublicMove } from '../../shared/types';
import { formatJoinCode } from './codes';
import type { LoadedGame, MoveRow } from './store';

export function toPublicMove(m: MoveRow): PublicMove {
  const base = { seat: m.seat, turn: m.turnNumber };
  if (m.type === 'play') {
    return {
      ...base,
      type: 'play',
      tiles: (m.tiles ?? []).map((t) => ({ r: t.r, c: t.c, letter: t.letter, blank: t.blank })),
      words: (m.words ?? []).map((w) => ({ word: w.word, score: w.score })),
      score: m.score,
    };
  }
  if (m.type === 'swap') return { ...base, type: 'swap', count: m.swappedCount ?? 0 };
  return { ...base, type: 'pass' };
}

/** A log entry; the private part only for the viewer's own moves. */
export function toLogMove(m: MoveRow, viewerSeat: number): LogMove {
  const pub = toPublicMove(m);
  if (m.seat !== viewerSeat || !m.private) return pub;
  const p = m.private;
  return { ...pub, private: { ...(p.swapped && { swapped: [...p.swapped] }), drawn: [...p.drawn] } };
}

export function toView({ game, seats }: LoadedGame, viewerSeat: number, last: MoveRow | undefined): GameView {
  const me = seats.find((s) => s.seat === viewerSeat);
  const finished = game.status === 'finished';
  return {
    id: game.id,
    name: game.name,
    status: game.status,
    hostUserId: game.hostId,
    joinCode: game.status === 'lobby' ? formatJoinCode(game.joinCode) : null,
    seatCount: game.seatCount,
    bagSize: game.bagSize,
    expandedWords: game.expandedWords,
    turnNumber: game.turnNumber,
    currentSeat: game.currentSeat,
    turnStartedAt: game.turnStartedAt,
    bagCount: game.bag ? bagCount(game.bag) : game.bagSize,
    board: (game.board ?? emptyBoard()).map((row) =>
      row.map((t) => (t ? { letter: t.letter, blank: t.blank, seat: t.seat, turn: t.turn } : null)),
    ),
    players: seats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      displayName: s.displayName,
      colorIndex: s.colorIndex ?? s.seat,
      score: s.score,
      rackCount: s.rack.length,
    })),
    role: 'player',
    mySeat: me ? me.seat : null,
    myRack: me ? [...me.rack] : null,
    spectatorRacks: null,
    spectatorsSeeRacks: false,
    watching: [],
    houseWords: { add: [], ban: [] },
    lastMove: last ? toPublicMove(last) : null,
    finalRoundAfter: game.finalRoundAfter,
    ...(finished && {
      finalRacks: seats.map((s) => ({ seat: s.seat, rack: [...s.rack] })),
      winnerSeats: winnerSeats(seats.map((s) => s.score)),
    }),
  };
}
