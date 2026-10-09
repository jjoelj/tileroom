// SPDX-License-Identifier: AGPL-3.0-or-later
// App-wide state shared across routes: the signed-in user and the current path.

export type Me = { id: string; username: string; displayName: string; isAdmin: boolean; remindTurn: boolean; pushReady: boolean };

/** undefined = still loading, null = signed out. */
export const session = $state<{ me: Me | null | undefined }>({ me: undefined });

export const route = $state({ path: location.pathname });

/** Bumped when a push arrives or a notification is tapped: open screens refetch right away. */
export const updates = $state({ n: 0 });

const readPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');

/**
 * This device's notification permission. Checked on every launch and every return to the app: an installed
 * Android app has its own permission, separate from the browser's, even though it shares the session.
 */
export const device = $state<{ permission: NotificationPermission | 'unsupported' }>({ permission: readPermission() });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') device.permission = readPermission();
});

/** Navigates; `path` may carry a query (/new?group=ID), which stays in the URL while routing uses the path alone. */
export function go(path: string) {
  if (path === location.pathname + location.search) return;
  history.pushState(null, '', path);
  route.path = location.pathname;
  scrollTo(0, 0);
}

// An invite link (/join/CODE for a game, /groups/join/CODE for a group) survives install, sign-in and sign-up
// (sessionStorage is per tab and per installed app).
const JOIN_KEY = 'tileroom:join';
/** An account invite link (/signup/CODE): opens sign-up with the code filled in. Sign-up skips the install gate. */
export const signupCodeIn = (path: string) => path.match(/^\/signup\/([\w-]+)$/)?.[1];
export const joinCodeIn = (path: string) => path.match(/^\/join\/([\w-]+)$/)?.[1];
/** The invite in a path, if it is one: which kind, and its code. */
export const inviteIn = (path: string) => {
  const m = path.match(/^\/(groups\/)?join\/([\w-]+)$/);
  return m ? { kind: m[1] ? ('group' as const) : ('game' as const), code: m[2]!, path } : undefined;
};
const remembered = inviteIn(location.pathname);
try {
  if (remembered) sessionStorage.setItem(JOIN_KEY, remembered.path);
} catch {
  // storage blocked: the link still works if they stay on this page
}

/** Where to land after signing in: the pending invite link, else the lobby. */
export function home() {
  try {
    const path = sessionStorage.getItem(JOIN_KEY);
    return path && inviteIn(path) ? path : '/';
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
