// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from './api';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // vite-plugin-pwa serves the dev worker as an ES module at /dev-sw.js
  const url = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
  navigator.serviceWorker.register(url, { type: import.meta.env.DEV ? 'module' : 'classic', scope: '/' }).catch(() => {});
}

/** Closes this device's notifications for a game ("game-ID") or group ("group-ID"): it's on screen, so they're seen. */
export async function clearNotifications(tag: string) {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  for (const n of (await reg?.getNotifications({ tag })) ?? []) n.close();
}

/** Closes notifications seen since they were sent, on any device: that game or group opened, or one swiped away. */
export async function closeSeenNotifications() {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  const shown = ((await reg?.getNotifications().catch(() => [])) ?? []).filter((n) => n.tag);
  if (!shown.length) return; // nothing up: no request
  const seen = await api<Record<string, number>>('/push/seen').catch(() => ({}) as Record<string, number>);
  for (const n of shown) {
    const at = seen[n.tag];
    if (at !== undefined && ((n.data as { sentAt?: number } | null)?.sentAt ?? 0) <= at) n.close();
  }
}

const toBytes =(b64url: string) => {
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
