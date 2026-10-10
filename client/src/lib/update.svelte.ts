// SPDX-License-Identifier: AGPL-3.0-or-later
// Updates, never forced: the app checks quietly on launch, on each return to the front, and when the socket reconnects
// after a deploy (live.svelte.ts). A new version takes over at once (sw.ts: skipWaiting + claim), but this page keeps
// running the old code until the user taps "Update ready · Reload" in the footer (App.svelte).

/** `ready`: a newer version is installed; the footer offers the reload. */
export const update = $state({ ready: false });

/** Asks for a new version now; one that takes over makes the reload offer appear. */
export function checkQuietly() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
}

/** Watches for new versions: checks on launch and on each return to the front. */
export function checkForUpdates() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const hadController = !!navigator.serviceWorker.controller; // a first install's takeover isn't an update
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) update.ready = true;
  });
  checkQuietly();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkQuietly());
}
