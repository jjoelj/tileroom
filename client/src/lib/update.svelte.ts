// SPDX-License-Identifier: AGPL-3.0-or-later
// Updates, checked before the user sees anything: on launch, and on return after a while away, a splash covers the
// app (App.svelte) while we ask for a new version. If there is one, it installs and the page reloads behind the
// splash, so nothing being typed or looked at is ever interrupted. (sw.ts takes over at once: skipWaiting + claim.)

/** `ready`: a new version took over while the app was in use; the footer offers to reload (App.svelte). */
export const update = $state<{ phase: 'checking' | 'updating' | null; ready: boolean }>({ phase: null, ready: false });

const AWAY_MS = 60_000; // shorter trips (a quick app switch) don't get a splash
const CHECK_MS = 3_000; // offline or slow: open the app anyway
const INSTALL_MS = 15_000; // a slow install: open the app; it updates on the next return

// A new version that took over mid-use (the browser checks on its own too): this page is stale; reload at the next check.
let stale = false;

const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);

async function check() {
  update.phase = 'checking';
  if (stale) return location.reload();
  const reg = await within(navigator.serviceWorker.getRegistration(), CHECK_MS).catch(() => undefined);
  // No worker yet (first visit) or none controlling this page: nothing to update from.
  if (reg && navigator.serviceWorker.controller) {
    await within(reg.update(), CHECK_MS).catch(() => {});
    const next = reg.installing ?? reg.waiting;
    if (next) {
      update.phase = 'updating';
      const tookOver = new Promise<true>((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(true), { once: true }));
      if (await within(tookOver, INSTALL_MS)) return location.reload(); // the splash stays up through the reload
    }
  }
  update.phase = null;
}

/** Asks for a new version now, without a splash; one that takes over gets the footer's reload offer. */
export function checkQuietly() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV || update.phase !== null) return;
  void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
}

/** Runs the check on launch and on each return from a while away. */
export function checkForUpdates() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const hadController = !!navigator.serviceWorker.controller; // a first install's takeover isn't an update
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && update.phase === null) stale = update.ready = true;
  });
  void check();
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (Date.now() - hiddenAt >= AWAY_MS) void check();
  });
}
