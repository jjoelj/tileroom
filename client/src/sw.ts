// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// App shell, fonts and word lists. /api is never cached (SPEC §9.5).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

type Payload = { title: string; body: string; url?: string; tag?: string };

self.addEventListener('push', (e) => {
  const p: Payload = e.data?.json() ?? { title: 'Tileroom', body: '' };
  // renotify: a newer notification for the same game replaces the old one but still alerts (sound, pop-up).
  const options: NotificationOptions & { renotify?: boolean } = { body: p.body, tag: p.tag, renotify: !!p.tag, data: { url: p.url ?? '/' }, icon: import.meta.env.VITE_STAGING === '1' ? '/icons/staging/icon-192.png' : '/icons/icon-192.png' };
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window' });
      // Open windows refetch now instead of waiting for their next poll.
      for (const w of wins) w.postMessage({ type: 'refresh' });
      // Someone looking at Tileroom right now sees the update; don't also notify them.
      // iOS may revoke subscriptions that get pushes without a notification, so it always notifies; the server
      // already skips the push while the user has the game open (realtime.ts `watching`).
      // Only game updates are skipped: the test notification is sent from inside the app and must always show.
      const watching = !!p.tag?.startsWith('game-') && wins.some((w) => w.focused && w.visibilityState === 'visible');
      if (watching && !/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
      await self.registration.showNotification(p.title, options);
    })(),
  );
});

// Where the last tapped notification points, for a few seconds. Android may resume or cold-start the app
// without delivering our message (or at "/"), so the app also asks for it on start and on return (`where`).
let tapped: { url: string; at: number } | null = null;

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url: string = e.notification.data?.url ?? '/';
  tapped = { url, at: Date.now() };
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => w.focused) ?? wins.find((w) => w.visibilityState === 'visible') ?? wins[0];
      if (!win) return void (await self.clients.openWindow(url));
      // Bring the app forward first, then let it route itself (no reload).
      const front = await win.focus().catch(() => win);
      front.postMessage({ type: 'navigate', url });
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'where') return;
  if (tapped && Date.now() - tapped.at < 10_000) (e.source as Client | null)?.postMessage({ type: 'navigate', url: tapped.url });
  tapped = null;
});

// iOS sometimes drops subscriptions; re-subscribe with the same key and tell the server (SPEC §8).
self.addEventListener('pushsubscriptionchange', (e) => {
  const event = e as Event & { oldSubscription?: PushSubscription; waitUntil: (p: Promise<unknown>) => void };
  const key = event.oldSubscription?.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then((sub) =>
      fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) }),
    ),
  );
});
