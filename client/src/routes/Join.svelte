<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { names, plural } from '../../../shared/plural';
  import { MAX_PLAYERS } from '../../../shared/rules';
  import { api, ApiError } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { show } from '../lib/motion';
  import { back, forgetJoin, go } from '../lib/state.svelte';

  let { code }: { code: string } = $props();

  type Preview = {
    id: string;
    status: 'lobby' | 'active' | 'finished';
    hostName: string | null;
    players: string[];
    joined: boolean;
    group: { id: string; name: string } | null;
    canJoin: boolean;
  };

  let game = $state<Preview | null>(null);
  let busy = $state(false);

  onMount(async () => {
    try {
      game = await api<Preview>(`/join/${encodeURIComponent(code)}`);
      if (game.joined) open(game.id);
    } catch (e) {
      sayError(e);
    }
  });

  function open(id: string) {
    forgetJoin();
    go(`/games/${id}`, { replace: true });
  }

  async function join() {
    busy = true;
    try {
      const view = await api<{ id: string }>(`/join/${encodeURIComponent(code)}`, { method: 'POST' });
      open(view.id);
    } catch (e) {
      sayError(e);
      busy = false;
    }
  }

  function leave() {
    forgetJoin();
    back();
  }

  const full = $derived(!!game && game.players.length >= MAX_PLAYERS);
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; padding: 0 8px">
    <button class="iconbtn" aria-label="Back to games" onclick={leave}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
  </header>

  <div style="padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 16px; flex-grow: 1">
    <span class="label">Join game · {code.toUpperCase()}</span>
    {#if game}
      <h1 in:show={{ y: 6 }} class="h1" style="font-size: 32px">{names(game.players)}</h1>
      <p class="lead" in:show={{ y: 6, delay: 40 }}>
        {game.hostName ? `${game.hostName} invited you.` : ''}
        {plural(game.players.length, 'player has', 'players have')} joined, up to {MAX_PLAYERS}.
      </p>
      {#if game.group}<span class="hint">A {game.group.name} game, with its house words</span>{/if}
      {#if game.status !== 'lobby'}
        <p class="error" in:show>This game has already started.</p>
      {:else if full}
        <p class="error" in:show>This game is full.</p>
      {:else if !game.canJoin}
        <p class="error" in:show>This game is for {game.group?.name} members. Join the group first with its group code.</p>
      {/if}
    {/if}

    <div style="margin-top: auto; display: flex; flex-direction: column; gap: 10px">
      {#if game && game.status === 'lobby' && !full && game.canJoin}
        <button class="primary" in:show disabled={busy} onclick={join}>Join game</button>
      {/if}
      <button class="secondary" onclick={leave}>Back to games</button>
    </div>
  </div>
</main>
