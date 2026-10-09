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
  e.waitUntil(self.registration.showNotification(p.title, { body: p.body, tag: p.tag, data: { url: p.url ?? '/' }, icon: '/icons/icon-192.png' }));
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
