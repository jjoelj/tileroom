<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import Dialog from './lib/Dialog.svelte';
  import Toast from './lib/Toast.svelte';
  import { rise, show } from './lib/motion';
  import { preloadWords } from './lib/dict';
  import { pushSupported, subscribe } from './lib/push';
  import { say } from './lib/say.svelte';
  import { markSeen, REPO, unseenReleases, VERSION } from './lib/changelog';
  import { update } from './lib/update.svelte';
  import WhatsNew from './lib/WhatsNew.svelte';
  import WhatsNewPage from './routes/WhatsNew.svelte';
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
  import Admin from './routes/Admin.svelte';
  import Leaderboard from './routes/Leaderboard.svelte';
  import SignUp from './routes/SignUp.svelte';

  // Gates (SPEC §9.6), in order: signed in → installed → notifications. Anyone can sign in or sign up in a browser;
  // after that, phones and tablets need the installed app (iOS push needs it). Desktop browsers push from a tab, so
  // they skip install. iPadOS reports a Mac UA, hence the touch check. The bypass is dev-only.
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const installed = standalone || !mobile || (import.meta.env.DEV && import.meta.env.VITE_SKIP_PWA_GATE === '1');

  onMount(() => {
    api<Me>('/me')
      .then((me) => (session.me = me))
      .catch(() => (session.me = null));
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate') go(e.data.url);
      if (e.data?.type === 'navigate' || e.data?.type === 'refresh') updates.n++;
      // News about somewhere else while the app is in front (sw.ts): a tappable banner, unless already there.
      if (e.data?.type === 'banner' && e.data.url !== route.path) say(e.data.body, { title: e.data.title, url: e.data.url });
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

  // An account invite link opened while signed in: it's for someone new, so leave it unused and say so.
  $effect(() => {
    if (session.me && route.path.startsWith('/signup')) {
      say(`You're already signed in as @${session.me.username}. That invite is for a new account, so pass it on.`);
      go('/');
    }
  });

  const gameId = $derived(route.path.match(/^\/games\/([\w-]+)$/)?.[1]);
  const groupCode = $derived(route.path.match(/^\/groups\/join\/([\w-]+)$/)?.[1]);
  const groupId = $derived(groupCode ? undefined : route.path.match(/^\/groups\/([\w-]+)$/)?.[1]);
  const joinCode = $derived(joinCodeIn(route.path));
  // After an update: what's new since this device's last version, once, over the app proper (not the gates).
  let news = $state(unseenReleases());
  const closeNews = () => {
    markSeen();
    news = [];
  };

  // Which screen is up; changing it fades the new one in.
  const screen = $derived(
    session.me === undefined
      ? 'loading'
      : session.me === null
        ? route.path.startsWith('/signup') ? 'signup' : 'signin'
        : !installed
          ? 'install'
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
                : route.path === '/new' ? 'new' : route.path === '/settings' ? 'settings' : route.path === '/whats-new' ? 'whats-new' : route.path === '/leaderboard' ? 'leaderboard' : route.path === '/admin' && session.me?.isAdmin ? 'admin' : 'lobby',
  );
</script>

{#key screen}
<div in:show={{ duration: 180 }}>
{#if session.me === undefined}
  <div class="screen" aria-busy="true"></div>
{:else if session.me === null}
  {#if route.path.startsWith('/signup')}<SignUp />{:else}<SignIn />{/if}
{:else if !installed}
  <Install />
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
{:else if route.path === '/admin' && session.me.isAdmin}
  <Admin />
{:else if route.path === '/leaderboard'}
  <Leaderboard />
{:else if route.path === '/whats-new'}
  <WhatsNewPage />
{:else}
  <Lobby />
{/if}
</div>
{/key}

<footer>
  {#if update.ready}
    <button class="reload" transition:show onclick={() => location.reload()}><span>Update ready · Reload</span></button>
  {/if}
  <a href={`${REPO}${VERSION === 'dev' ? '' : `/tree/${VERSION}`}`} target="_blank" rel="noopener" title="View source" aria-label={`View source (${VERSION})`}>{VERSION}</a>
</footer>

{#if news.length && session.me?.pushReady && device.permission === 'granted'}
  <div class="bg" transition:show role="presentation" onclick={closeNews}></div>
  <div class="sheet" transition:rise role="dialog" aria-modal="true" aria-labelledby="news-title">
    <h2 id="news-title" class="h1" style="font-size: 22px">What's new</h2>
    <div class="news"><WhatsNew list={news} /></div>
    <button class="primary" onclick={closeNews}>Got it</button>
  </div>
{/if}

<Dialog />
<Toast />

<style>
  .bg { position: fixed; inset: 0; background: var(--scrim); z-index: 40; }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; max-width: 480px; max-height: 80dvh; margin: 0 auto;
    display: flex; flex-direction: column; gap: 16px;
    background: var(--surface); border-radius: 24px 24px 0 0; padding: 24px 20px calc(20px + env(safe-area-inset-bottom));
    box-shadow: 0 -10px 30px var(--shadow);
  }
  .news { overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
  footer { height: var(--foot); max-width: 480px; margin: 0 auto; display: flex; align-items: center; justify-content: flex-end; }
  /* 44px tap target; the visible pill inside is smaller so the footer stays slim */
  .reload { margin-right: auto; margin-left: 8px; height: 44px; padding: 0 8px; border: none; background: none; }
  .reload span { display: flex; align-items: center; height: 30px; padding: 0 14px; border-radius: 15px; background: var(--primary); color: var(--on-primary); font-weight: 700; font-size: 13px; }
  footer a { min-height: 44px; display: flex; align-items: center; padding: 0 16px; font: 400 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); opacity: 0.7; text-decoration: none; }
</style>
