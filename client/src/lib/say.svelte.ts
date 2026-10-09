// SPDX-License-Identifier: AGPL-3.0-or-later
// Short status messages that float over the screen (Toast.svelte, mounted once in App), so nothing shifts.
import { ApiError } from './api';

export const toast = $state<{ current: { id: number; text: string; bad: boolean } | null }>({ current: null });

let n = 0;
let timer = 0;

/** Shows `text` for a few seconds (errors a little longer); a newer message replaces the current one. */
export function say(text: string, { bad = false } = {}) {
  const id = ++n;
  toast.current = { id, text, bad };
  clearTimeout(timer);
  timer = window.setTimeout(
    () => {
      if (toast.current?.id === id) toast.current = null;
    },
    bad ? 6000 : 3500,
  );
}

/** For a failed request: the server's message, or a generic connection hint. */
export const sayError = (e: unknown) => say(e instanceof ApiError ? e.message : 'Check your connection and try again.', { bad: true });
