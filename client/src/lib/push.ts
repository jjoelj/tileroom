// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from './api';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // vite-plugin-pwa serves the dev worker as an ES module at /dev-sw.js
  const url = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
  navigator.serviceWorker.register(url, { type: import.meta.env.DEV ? 'module' : 'classic', scope: '/' }).catch(() => {});
}

const toBytes = (b64url: string) => {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

/** Subscribes this device (or reuses its subscription) and attaches it to the session (SPEC §8). */
export async function subscribe() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The app's background worker didn't start. Reload and try again.")), 10_000)),
  ]);
  const { publicKey } = await api<{ publicKey: string }>('/push/key');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }));
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
}
