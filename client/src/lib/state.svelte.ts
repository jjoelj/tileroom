// SPDX-License-Identifier: AGPL-3.0-or-later
// App-wide state shared across routes: the signed-in user and the current path.

export type Me = { id: string; username: string; displayName: string; isAdmin: boolean; remindTurn: boolean; pushReady: boolean };

/** undefined = still loading, null = signed out. */
export const session = $state<{ me: Me | null | undefined }>({ me: undefined });

export const route = $state({ path: location.pathname });

export function go(path: string) {
  if (path === route.path) return;
  history.pushState(null, '', path);
  route.path = path;
  scrollTo(0, 0);
}

addEventListener('popstate', () => {
  route.path = location.pathname;
});
