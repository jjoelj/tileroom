<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { MAX_PLAYERS } from '../../../shared/rules';
  import { api, ApiError } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { show } from '../lib/motion';
  import { go } from '../lib/state.svelte';

  // /new?group=ID: a group game (its words, its members only); otherwise an open game.
  const groupId = new URLSearchParams(location.search).get('group');
  let groupName = $state('');
  let words = $state<{ add: string[]; ban: string[] } | null>(null);
  if (groupId) {
    api<{ name: string; words: { add: string[]; ban: string[] } }>(`/groups/${encodeURIComponent(groupId)}`)
      .then((g) => {
        groupName = g.name;
        words = g.words;
      })
      .catch(() => {});
  }

  let bagSize = $state<100 | 150>(100);
  let randomOrder = $state(true);
  let expandedWords = $state(false);
  let busy = $state(false);

  async function create() {
    busy = true;
    try {
      const view = await api<{ id: string }>('/games', { method: 'POST', body: { bagSize, randomOrder, expandedWords, ...(groupId && { groupId }) } });
      go(`/games/${view.id}`);
    } catch (err) {
      sayError(err);
      busy = false;
    }
  }
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back" onclick={() => go(groupId ? `/groups/${groupId}` : '/')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px; flex-grow: 1">New game</h1>
    <span class="tag">{groupId ? groupName || 'Group game' : 'Open game'}</span>
  </header>

  <div style="padding: 4px 16px 0; display: flex; flex-direction: column; gap: 18px; flex-grow: 1">
    {#if groupId && words}
      <!-- what this game will be played with: copied from the group when the game starts -->
      <div class="card words" in:show={{ y: 6 }}>
        <span class="strong">House words</span>
        {#if words.add.length}
          <span class="hint">Added</span>
          <div class="chips">{#each words.add as w (w)}<span class="chip">{w}</span>{/each}</div>
        {/if}
        {#if words.ban.length}
          <span class="hint">Banned</span>
          <div class="chips">{#each words.ban as w (w)}<span class="chip">{w}</span>{/each}</div>
        {/if}
        {#if !words.add.length && !words.ban.length}
          <span class="hint">None yet: this game uses the standard word list.</span>
        {:else}
          <span class="hint">Locked in when the game starts. Later votes won't change it.</span>
        {/if}
      </div>
    {/if}

    <div class="card">
      <div class="line">
        <div class="stack" style="gap: 1px">
          <span class="strong">Tile bag</span>
          <span class="hint">{bagSize === 150 ? 'Big bag, good for 5 or 6 players' : 'Standard bag'}</span>
        </div>
        <div class="segment" role="radiogroup" aria-label="Tile bag">
          {#each [100, 150] as const as size (size)}
            <button
              role="radio"
              aria-checked={bagSize === size}
              class:on={bagSize === size}
              onclick={() => (bagSize = size)}>{size}</button
            >
          {/each}
        </div>
      </div>
      <label class="line toggle">
        <span class="stack" style="gap: 1px">
          <span>Random turn order</span>
          <span class="hint">{randomOrder ? 'Shuffled at start' : 'Order joined, you first'}</span>
        </span>
        <input type="checkbox" bind:checked={randomOrder} />
      </label>
      <label class="line toggle">
        <span class="stack" style="gap: 1px">
          <span>Use expanded word list</span>
          <span class="hint">{expandedWords ? 'Abbreviations like FAQ allowed' : 'Standard words only'}</span>
        </span>
        <input type="checkbox" bind:checked={expandedWords} />
      </label>
    </div>
  </div>

  <div style="padding: 12px 16px 20px; display: flex; flex-direction: column; gap: 8px">
    <button class="primary" onclick={create} disabled={busy}>Create game</button>
    <div class="hint" style="text-align: center">
      {groupId
        ? `Uses ${groupName ? `${groupName}${groupName.endsWith('s') ? "'" : "'s"}` : "the group's"} house words. Only members can join, up to ${MAX_PLAYERS}.`
        : `You'll get a code to share. Up to ${MAX_PLAYERS} can join, and you start whenever you're ready.`}
    </div>
  </div>
</main>

<style>
  .tag { height: 30px; padding: 0 10px; margin-right: 8px; border-radius: 999px; background: var(--primary); color: var(--on-primary); font-size: 12px; font-weight: 800; display: flex; align-items: center; }
  .card { overflow: hidden; }
  .words { padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 132px; overflow: auto; }
  .chip { padding: 4px 10px; border-radius: 999px; background: var(--well); font-weight: 800; font-size: 13px; letter-spacing: 0.04em; }
  .line { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 8px 0 14px; min-height: 60px; }
  .line + .line { border-top: 1px solid var(--line-soft); }
  .strong { font-weight: 800; font-size: 16px; }
  .segment { display: flex; background: var(--well); border-radius: 12px; padding: 3px; }
  .segment button { height: 38px; min-width: 52px; padding: 0 12px; border-radius: 9px; border: none; background: transparent; font-weight: 700; font-size: 14px; }
  .segment button.on { background: var(--surface); }
  .toggle { padding-right: 14px; font-weight: 800; font-size: 15px; }
  .toggle input { width: 22px; height: 22px; accent-color: var(--ink); flex-shrink: 0; }
</style>
