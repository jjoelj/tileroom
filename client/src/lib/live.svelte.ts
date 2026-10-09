// SPDX-License-Identifier: AGPL-3.0-or-later
// The realtime socket (SPEC §7): notify-only. Tells the server what's on screen; receives our view of the open
// game, or a nudge to refetch the games list. Reconnects with backoff; screens also refetch on return to the app.
import type { GameView } from '../../../shared/types';

/** The latest pushed view of the watched game, and counters bumped when the games list or the open group changed. */
export const live = $state<{ view: GameView | null; lobby: number; group: number }>({ view: null, lobby: 0, group: 0 });

let ws: WebSocket | null = null;
let sub = '';
let tries = 0;
let retry = 0;

// Only a visible, focused window counts as watching; otherwise the server sends pushes as usual.
// (A desktop window behind another one is still "visible", so focus matters too.)
const current = () => (document.visibilityState === 'visible' && document.hasFocus() ? sub : '');
const tell = () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ sub: current() }));

function connect() {
  clearTimeout(retry);
  ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
  ws.onopen = () => {
    tries = 0;
    tell();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as { t: 'game'; view: GameView } | { t: 'lobby' } | { t: 'group' };
    if (m.t === 'game') live.view = m.view;
    else if (m.t === 'group') live.group++;
    else live.lobby++;
  };
  ws.onclose = () => {
    ws = null;
    retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
  };
}

/** What's on screen: a game id, "group:<id>" or "lobby". Opens the socket on first use. Returns the cleanup for unmount. */
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
addEventListener('focus', () => sub && tell());
addEventListener('blur', () => sub && tell());
