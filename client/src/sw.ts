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
  const options: NotificationOptions & { renotify?: boolean } = { body: p.body, tag: p.tag, renotify: !!p.tag, data: { url: p.url ?? '/' }, icon: '/icons/icon-192.png' };
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window' });
      // Open windows refetch now instead of waiting for their next poll.
      for (const w of wins) w.postMessage({ type: 'refresh' });
      // Someone looking at Tileroom right now sees the update; don't also notify them.
      // ponytail: iOS may revoke subscriptions that get pushes without a notification, so it always notifies;
      // milestone 4 skips the push server-side while the user has a live socket.
      const watching = wins.some((w) => w.focused && w.visibilityState === 'visible');
      if (watching && !/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
      await self.registration.showNotification(p.title, options);
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url: string = e.notification.data?.url ?? '/';
  e.waitUntil(
    (async () => {
      const [win] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (!win) return void (await self.clients.openWindow(url));
      await win.focus();
      win.postMessage({ type: 'navigate', url });
    })(),
  );
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
