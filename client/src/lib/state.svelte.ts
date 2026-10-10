// SPDX-License-Identifier: AGPL-3.0-or-later
// App-wide state shared across routes: the signed-in user and the current path.

export type Me = { id: string; username: string; displayName: string; isAdmin: boolean; remindTurn: boolean; showOnGlobal: boolean; pushReady: boolean };

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

// Back button (Android's, the browser's, and our own arrows) walks real history. Each entry records how many in-app
// screens sit below it (`depth`), so an arrow knows whether going back stays in the app.
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0;
// Chrome's back button skips a screen whose page added a history entry before the user had touched it (its
// "history manipulation" intervention), so entries are only ever added once they have.
const touched = () => navigator.userActivation?.hasBeenActive ?? true;
if ((history.state as { depth?: number } | null)?.depth === undefined && location.pathname !== '/') {
  // Opened straight onto a screen (a notification, a link): put the games list under it on the first tap, so back
  // goes home instead of closing the app. A reload keeps its state, so this runs once per fresh start.
  const here = location.pathname + location.search;
  history.replaceState({ depth: 0 }, '');
  addEventListener(
    'click',
    () => {
      if (depth() !== 0 || location.pathname + location.search !== here) return;
      history.replaceState({ depth: 0 }, '', '/');
      history.pushState({ depth: 1 }, '', here);
    },
    { capture: true, once: true }, // before the tap's own handler, which may navigate
  );
} else history.replaceState({ ...history.state, depth: depth() }, '');

/**
 * Navigates; `path` may carry a query (/new?group=ID), which stays in the URL while routing uses the path alone.
 * `replace`: this screen takes the current one's place, so back skips it (a finished New game or Join screen).
 */
export function go(path: string, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  entry = false; // an open overlay's entry stays buried under the new screen
  if (replace) history.replaceState({ depth: depth() }, '', path);
  else history.pushState({ depth: depth() + 1 }, '', path);
  route.path = location.pathname;
  scrollTo(0, 0);
}

/** Our back arrows: back in history like the system button; opened straight onto this screen, go to `fallback`. */
export function back(fallback = '/') {
  if (depth() > 0) return history.back();
  history.replaceState({ depth: 0 }, '', fallback);
  route.path = location.pathname;
  scrollTo(0, 0);
}

// Open sheets, menus and dialogs share one history entry: the back button closes the top one, not the screen.
const overlays: (() => void)[] = [];
let entry = false; // our overlay entry is in history above the screen's own
const onOverlayEntry = () => !!(history.state as { overlay?: boolean } | null)?.overlay;

/** For a sheet, menu or dialog: while `open()` is true, the back button closes it. Call during component setup. */
export function backCloses(open: () => boolean, close: () => void) {
  $effect(() => {
    if (!open()) return;
    overlays.push(close);
    if (!entry && touched()) {
      history.pushState({ depth: depth(), overlay: true }, '');
      entry = true;
    }
    return () => {
      const i = overlays.lastIndexOf(close);
      if (i >= 0) overlays.splice(i, 1);
      // Closed some other way: drop the entry, unless another overlay opened meanwhile (a menu item opening a dialog).
      setTimeout(() => {
        if (overlays.length || !entry) return;
        entry = false;
        if (onOverlayEntry()) history.back();
      });
    };
  });
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
  if (entry && !onOverlayEntry()) {
    // the back button popped our overlay entry: close the top overlay, keep the screen
    entry = false;
    overlays.pop()?.();
    if (overlays.length) {
      history.pushState({ depth: depth(), overlay: true }, '');
      entry = true;
    }
    return;
  }
  // Back while an overlay that has no entry of its own is open (one that opened before any tap, like What's new
  // after an update): it closes along with the screen change.
  while (!entry && overlays.length) overlays.pop()?.();
  if (route.path !== location.pathname) route.path = location.pathname;
});
