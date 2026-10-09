// SPDX-License-Identifier: AGPL-3.0-or-later
// Updates: the worker takes over new versions at once (sw.ts: skipWaiting + claim), but an open page keeps running
// the old code. Reload only when it's safe: right after the app opens or comes back to the front, never mid-move.

/** Checks for a new version each time the app returns, and reloads into it on a return. */
export function reloadOnReturn() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  let returnedAt = Date.now(); // opening the app counts as a return
  let pending = false;
  let controlled = !!navigator.serviceWorker.controller; // the first install's takeover isn't an update

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    // Just opened or returned: nothing's been touched yet, so reload now. Otherwise wait for the next return.
    if (Date.now() - returnedAt < 3000) location.reload();
    else pending = true;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pending) return location.reload();
    returnedAt = Date.now();
    void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}
