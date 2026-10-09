// SPDX-License-Identifier: AGPL-3.0-or-later
// App-wide state shared across routes: the signed-in user and the current path.

export type Me = { id: string; username: string; displayName: string; isAdmin: boolean; remindTurn: boolean; pushReady: boolean };

/** undefined = still loading, null = signed out. */
export const session = $state<{ me: Me | null | undefined }>({ me: undefined });

export const route = $state({ path: location.pathname });

const readPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');

/**
 * This device's notification permission. Checked on every launch and every return to the app: an installed
 * Android app has its own permission, separate from the browser's, even though it shares the session.
 */
export const device = $state<{ permission: NotificationPermission | 'unsupported' }>({ permission: readPermission() });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') device.permission = readPermission();
});

export function go(path: string) {
  if (path === route.path) return;
  history.pushState(null, '', path);
  route.path = path;
  scrollTo(0, 0);
}

addEventListener('popstate', () => {
  route.path = location.pathname;
});
