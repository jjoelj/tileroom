<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api';
  import { forgetJoin, go } from '../lib/state.svelte';

  let { code }: { code: string } = $props();

  type Preview = { id: string; name: string; status: 'lobby' | 'active' | 'finished'; seatCount: number; hostName: string | null; players: string[]; joined: boolean };

  let game = $state<Preview | null>(null);
  let error = $state('');
  let busy = $state(false);

  onMount(async () => {
    try {
      game = await api<Preview>(`/join/${encodeURIComponent(code)}`);
      if (game.joined) open(game.id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Check your connection and try again.';
    }
  });

  function open(id: string) {
    forgetJoin();
    go(`/games/${id}`);
  }

  async function join() {
    busy = true;
    error = '';
    try {
      const view = await api<{ id: string }>(`/join/${encodeURIComponent(code)}`, { method: 'POST' });
      open(view.id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Check your connection and try again.';
      busy = false;
    }
  }

  function back() {
    forgetJoin();
    go('/');
  }

  const full = $derived(!!game && game.players.length >= game.seatCount);
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; padding: 0 8px">
    <button class="iconbtn" aria-label="Back to games" onclick={back}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
  </header>

  <div style="padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 16px; flex-grow: 1">
    <span class="label">Join game · {code.toUpperCase()}</span>
    {#if game}
      <h1 class="h1" style="font-size: 32px">{game.name}</h1>
      <p class="lead">
        {game.hostName ? `${game.hostName} invited you.` : ''}
        {game.players.length} of {game.seatCount} seats filled: {game.players.join(', ')}.
      </p>
      {#if game.status !== 'lobby'}
        <p class="error">This game has already started.</p>
      {:else if full}
        <p class="error">This game is full.</p>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div style="margin-top: auto; display: flex; flex-direction: column; gap: 10px">
      {#if game && game.status === 'lobby' && !full}
        <button class="primary" disabled={busy} onclick={join}>Join game</button>
      {/if}
      <button class="secondary" onclick={back}>Back to games</button>
    </div>
  </div>
</main>
