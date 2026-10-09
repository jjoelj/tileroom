// SPDX-License-Identifier: AGPL-3.0-or-later
// The realtime socket (SPEC §7): notify-only. Tells the server what's on screen; receives our view of the open
// game, or a nudge to refetch the games list. Reconnects with backoff; screens also refetch on return to the app.
import type { GameView } from '../../../shared/types';

/** The latest pushed view of the watched game, and a counter bumped when the games list changed. */
export const live = $state<{ view: GameView | null; lobby: number }>({ view: null, lobby: 0 });

let ws: WebSocket | null = null;
let sub = '';
let tries = 0;
let retry = 0;

// Hidden screens don't count as watching: the server then sends pushes instead.
const current = () => (document.visibilityState === 'visible' ? sub : '');
const tell = () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ sub: current() }));

function connect() {
  clearTimeout(retry);
  ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
  ws.onopen = () => {
    tries = 0;
    tell();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as { t: 'game'; view: GameView } | { t: 'lobby' };
    if (m.t === 'game') live.view = m.view;
    else live.lobby++;
  };
  ws.onclose = () => {
    ws = null;
    retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
  };
}

/** What's on screen: a game id or "lobby". Opens the socket on first use. Returns the cleanup for unmount. */
export function watch(what: string) {
  sub = what;
  live.view = null;
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
