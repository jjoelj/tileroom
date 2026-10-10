// SPDX-License-Identifier: AGPL-3.0-or-later
// The realtime socket (SPEC §7): notify-only. Tells the server what's on screen; receives our view of the open
// game, or a nudge to refetch the games list. Reconnects with backoff; screens also refetch on return to the app.
import type { GameView } from '../../../shared/types';
import { checkQuietly } from './update.svelte';

/**
 * The latest pushed view of the watched game (or its id once it's `gone`: canceled or timed out), and counters bumped
 * when the games list or the open group changed.
 */
export const live = $state<{ view: GameView | null; gone: string | null; placing: Placing | null; lobby: number; group: number }>({
  view: null,
  gone: null,
  placing: null,
  lobby: 0,
  group: 0,
});
/** Where the player whose turn it is has tiles right now (squares only), in the watched game. */
export type Placing = { id: string; turn: number; squares: [number, number][] };

/** On my turn: the squares my tiles are on, for the others watching (realtime.ts `place`). */
export const tellPlacing = (squares: [number, number][]) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ placing: squares }));

let ws: WebSocket | null = null;
let sub = '';
let tries = 0;
let retry = 0;
let dropped = false;

// A visible window gets live updates. Only a focused one counts as looking (here, watching, no push needed):
// a desktop window behind another one is still visible.
const tell = () =>
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ sub: document.visibilityState === 'visible' ? sub : '', focused: document.hasFocus() }));

function connect() {
  clearTimeout(retry);
  ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
  ws.onopen = () => {
    // Back after a drop: usually the server restarting for a deploy, so look for a new version right away.
    if (dropped) checkQuietly();
    dropped = false;
    tries = 0;
    tell();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as { t: 'game'; view: GameView } | { t: 'gone'; id: string } | ({ t: 'placing' } & Placing) | { t: 'lobby' } | { t: 'group' };
    if (m.t === 'game') live.view = m.view;
    else if (m.t === 'gone') live.gone = m.id;
    else if (m.t === 'placing') live.placing = { id: m.id, turn: m.turn, squares: m.squares };
    else if (m.t === 'group') live.group++;
    else live.lobby++;
  };
  ws.onclose = () => {
    ws = null;
    dropped = true;
    retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
  };
}

/** What's on screen: a game id, "group:<id>" or "lobby". Opens the socket on first use. Returns the cleanup for unmount. */
export function watch(what: string) {
  sub = what;
  live.view = null;
  live.gone = null;
  live.placing = null;
  if (ws) tell();
  else connect();
  return () => {
    if (sub !== what) return; // the next screen already said what it shows
    sub = '';
    tell();
  };
}

document.addEventListener('visibilitychange', () => {
  if (!sub) return;
  if (document.visibilityState === 'visible' && !ws) connect(); // iOS kills background sockets
  else tell();
});
addEventListener('focus', () => sub && tell());
addEventListener('blur', () => sub && tell());
