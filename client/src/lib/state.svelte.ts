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

// A /join/CODE link survives install, sign-in and sign-up (sessionStorage is per tab and per installed app).
const JOIN_KEY = 'tileroom:join';
export const joinCodeIn = (path: string) => path.match(/^\/join\/([\w-]+)$/)?.[1];
const remembered = joinCodeIn(location.pathname);
try {
  if (remembered) sessionStorage.setItem(JOIN_KEY, remembered);
} catch {
  // storage blocked: the link still works if they stay on this page
}

/** Where to land after signing in: the pending join link, else the lobby. */
export function home() {
  try {
    const code = sessionStorage.getItem(JOIN_KEY);
    return code ? `/join/${code}` : '/';
  } catch {
    return '/';
  }
}

export function forgetJoin() {
  try {
    sessionStorage.removeItem(JOIN_KEY);
  } catch {
    // nothing stored
  }
}

addEventListener('popstate', () => {
  route.path = location.pathname;
});
