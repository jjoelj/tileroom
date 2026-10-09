<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Joining a group by its code (from a shared link or the lobby's code box). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { names } from '../../../shared/plural';
  import { api, ApiError } from '../lib/api';
  import { show } from '../lib/motion';
  import { go } from '../lib/state.svelte';

  let { code }: { code: string } = $props();

  type Preview = { id: string; name: string; members: string[]; joined: boolean };
  let group = $state<Preview | null>(null);
  let error = $state('');
  let busy = $state(false);

  onMount(async () => {
    try {
      group = await api<Preview>(`/groups/join/${encodeURIComponent(code)}`);
      if (group.joined) go(`/groups/${group.id}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Check your connection and try again.';
    }
  });

  async function join() {
    busy = true;
    error = '';
    try {
      const g = await api<{ id: string }>(`/groups/join/${encodeURIComponent(code)}`, { method: 'POST' });
      go(`/groups/${g.id}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Check your connection and try again.';
      busy = false;
    }
  }
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; padding: 0 8px">
    <button class="iconbtn" aria-label="Back to games" onclick={() => go('/')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
  </header>

  <div style="padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 16px; flex-grow: 1">
    <span class="label">Join group · {code.toUpperCase()}</span>
    {#if group}
      <h1 in:show={{ y: 6 }} class="h1" style="font-size: 32px">{group.name}</h1>
      <p class="lead" in:show={{ y: 6, delay: 40 }}>With {names(group.members)}. Members play with the group's house words, vote on new ones together, and can watch each other's games.</p>
    {/if}
    {#if error}<p class="error" role="alert" transition:show>{error}</p>{/if}

    <div style="margin-top: auto; display: flex; flex-direction: column; gap: 10px">
      {#if group}<button class="primary" in:show disabled={busy} onclick={join}>Join {group.name}</button>{/if}
      <button class="secondary" onclick={() => go('/')}>Back to games</button>
    </div>
  </div>
</main>
