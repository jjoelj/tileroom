<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import { preloadWords } from './lib/dict';
  import { pushSupported, subscribe } from './lib/push';
  import { device, go, joinCodeIn, type Me, route, session } from './lib/state.svelte';
  import Game from './routes/Game.svelte';
  import Install from './routes/Install.svelte';
  import Join from './routes/Join.svelte';
  import Lobby from './routes/Lobby.svelte';
  import NewGame from './routes/NewGame.svelte';
  import Notify from './routes/Notify.svelte';
  import SignIn from './routes/SignIn.svelte';
  import SignUp from './routes/SignUp.svelte';

  // Gate 1 (SPEC §9.6): only the installed app runs. The bypass exists in dev builds only.
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const installed = standalone || (import.meta.env.DEV && import.meta.env.VITE_SKIP_PWA_GATE === '1');

  onMount(() => {
    api<Me>('/me')
      .then((me) => (session.me = me))
      .catch(() => (session.me = null));
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate') go(e.data.url);
    });
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
  const joinCode = $derived(joinCodeIn(route.path));
</script>

{#if !installed}
  <Install />
{:else if session.me === undefined}
  <div class="screen" aria-busy="true"></div>
{:else if session.me === null}
  {#if route.path === '/signup'}<SignUp />{:else}<SignIn />{/if}
{:else if !session.me.pushReady || device.permission !== 'granted'}
  <Notify />
{:else if gameId}
  {#key gameId}<Game id={gameId} />{/key}
{:else if joinCode}
  {#key joinCode}<Join code={joinCode} />{/key}
{:else if route.path === '/new'}
  <NewGame />
{:else}
  <Lobby />
{/if}
