<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import Dialog from './lib/Dialog.svelte';
  import Toast from './lib/Toast.svelte';
  import { show } from './lib/motion';
  import { preloadWords } from './lib/dict';
  import { pushSupported, subscribe } from './lib/push';
  import { device, go, joinCodeIn, type Me, route, session, updates } from './lib/state.svelte';
  import Game from './routes/Game.svelte';
  import Group from './routes/Group.svelte';
  import GroupJoin from './routes/GroupJoin.svelte';
  import Install from './routes/Install.svelte';
  import Join from './routes/Join.svelte';
  import Lobby from './routes/Lobby.svelte';
  import NewGame from './routes/NewGame.svelte';
  import Notify from './routes/Notify.svelte';
  import SignIn from './routes/SignIn.svelte';
  import Settings from './routes/Settings.svelte';
  import SignUp from './routes/SignUp.svelte';

  // Gate 1 (SPEC §9.6): on phones and tablets only the installed app runs (iOS push needs it); desktop browsers
  // push from a tab, so they skip it. iPadOS reports a Mac UA, hence the touch check. The bypass is dev-only.
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const installed = standalone || !mobile || (import.meta.env.DEV && import.meta.env.VITE_SKIP_PWA_GATE === '1');
  // Signing up doesn't need the app: make the account here, then install (the install screen says to sign in there).
  const gated = $derived(!installed && !(route.path.startsWith('/signup') && !session.me));

  onMount(() => {
    api<Me>('/me')
      .then((me) => (session.me = me))
      .catch(() => (session.me = null));
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate') go(e.data.url);
      if (e.data?.type === 'navigate' || e.data?.type === 'refresh') updates.n++;
    });
    // Opened or resumed from a notification tap: ask the worker where it pointed (see sw.ts).
    const where = () => void navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: 'where' }));
    where();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && where());
    setTimeout(preloadWords, 500); // after first paint
  });

  // Permission granted but the session lost its subscription (new sign-in, iOS dropped it): re-subscribe silently.
  $effect(() => {
    const me = session.me;
    if (me && !me.pushReady && pushSupported() && device.permission === 'granted') {
      subscribe()
        .then(() => (me.pushReady = true))
        .catch(() => {});
    }
  });

  const gameId = $derived(route.path.match(/^\/games\/([\w-]+)$/)?.[1]);
  const groupCode = $derived(route.path.match(/^\/groups\/join\/([\w-]+)$/)?.[1]);
  const groupId = $derived(groupCode ? undefined : route.path.match(/^\/groups\/([\w-]+)$/)?.[1]);
  const joinCode = $derived(joinCodeIn(route.path));
  // AGPL: every page links the source of exactly what's running. VITE_VERSION is the tag (prod) or commit (staging); see deploy.sh.
  const REPO = 'https://github.com/jjoelj/tileroom';
  const VERSION: string = import.meta.env.VITE_VERSION || 'dev';

  // Which screen is up; changing it fades the new one in.
  const screen = $derived(
    gated
      ? 'install'
      : session.me === undefined
        ? 'loading'
        : session.me === null
          ? route.path.startsWith('/signup') ? 'signup' : 'signin'
          : !session.me.pushReady || device.permission !== 'granted'
            ? 'notify'
            : gameId
              ? `game:${gameId}`
              : groupCode
                ? `groupjoin:${groupCode}`
                : groupId
                  ? `group:${groupId}`
                  : joinCode
                ? `join:${joinCode}`
                : route.path === '/new' ? 'new' : route.path === '/settings' ? 'settings' : 'lobby',
  );
</script>

{#key screen}
<div in:show={{ duration: 180 }}>
{#if gated}
  <Install />
{:else if session.me === undefined}
  <div class="screen" aria-busy="true"></div>
{:else if session.me === null}
  {#if route.path.startsWith('/signup')}<SignUp />{:else}<SignIn />{/if}
{:else if !session.me.pushReady || device.permission !== 'granted'}
  <Notify />
{:else if gameId}
  {#key gameId}<Game id={gameId} />{/key}
{:else if groupCode}
  {#key groupCode}<GroupJoin code={groupCode} />{/key}
{:else if groupId}
  {#key groupId}<Group id={groupId} />{/key}
{:else if joinCode}
  {#key joinCode}<Join code={joinCode} />{/key}
{:else if route.path === '/new'}
  <NewGame />
{:else if route.path === '/settings'}
  <Settings />
{:else}
  <Lobby />
{/if}
</div>
{/key}

<footer>
  <a href={`${REPO}${VERSION === 'dev' ? '' : `/tree/${VERSION}`}`} target="_blank" rel="noopener" title="View source" aria-label={`View source (${VERSION})`}>{VERSION}</a>
</footer>

<Dialog />
<Toast />

<style>
  footer { height: var(--foot); max-width: 480px; margin: 0 auto; display: flex; align-items: center; justify-content: flex-end; }
  footer a { min-height: 44px; display: flex; align-items: center; padding: 0 16px; font: 400 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); opacity: 0.7; text-decoration: none; }
</style>
