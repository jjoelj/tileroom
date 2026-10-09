<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { go } from '../lib/state.svelte';

  let name = $state('Game night');
  let seatCount = $state(2);
  let bagSize = $state<100 | 150>(100);
  let bagTouched = $state(false);
  let randomOrder = $state(true);
  let expandedWords = $state(false);
  let error = $state('');
  let busy = $state(false);

  // The big bag is suggested for 5–6 players until the host picks one (SPEC §4.2).
  $effect(() => {
    if (!bagTouched) bagSize = seatCount >= 5 ? 150 : 100;
  });

  async function create() {
    busy = true;
    error = '';
    try {
      const view = await api<{ id: string }>('/games', { method: 'POST', body: { name, seatCount, bagSize, randomOrder, expandedWords } });
      go(`/games/${view.id}`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Check your connection and try again.';
      busy = false;
    }
  }
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back to games" onclick={() => go('/')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px; flex-grow: 1">New game</h1>
    <span class="tag">Open game</span>
  </header>

  <div style="padding: 4px 16px 0; display: flex; flex-direction: column; gap: 18px; flex-grow: 1">
    <div class="stack">
      <label for="gname" class="label">Game name</label>
      <input id="gname" class="field" bind:value={name} maxlength="40" />
    </div>

    <div class="card">
      <div class="line">
        <div class="stack" style="gap: 1px">
          <span class="strong">{seatCount} seats</span>
          <span class="hint">2 to 6 players</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px">
          <button class="step" aria-label="Fewer seats" disabled={seatCount <= 2} onclick={() => seatCount--}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14" /></svg>
          </button>
          <span class="count">{seatCount}</span>
          <button class="step" aria-label="More seats" disabled={seatCount >= 6} onclick={() => seatCount++}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="line">
        <div class="stack" style="gap: 1px">
          <span class="strong">Tile bag</span>
          <span class="hint">{bagSize === 150 ? 'Big bag, suggested for 5+' : 'Standard bag'}</span>
        </div>
        <div class="segment" role="radiogroup" aria-label="Tile bag">
          {#each [100, 150] as const as size (size)}
            <button
              role="radio"
              aria-checked={bagSize === size}
              class:on={bagSize === size}
              onclick={() => {
                bagSize = size;
                bagTouched = true;
              }}>{size}</button
            >
          {/each}
        </div>
      </div>
      <label class="line toggle">
        Random turn order
        <input type="checkbox" bind:checked={randomOrder} />
      </label>
      <label class="line toggle">
        <span class="stack" style="gap: 1px">
          <span>Use expanded word list</span>
          <span class="hint">Also allows abbreviations like FAQ and DIY</span>
        </span>
        <input type="checkbox" bind:checked={expandedWords} />
      </label>
    </div>
  </div>

  <div style="padding: 12px 16px 20px; display: flex; flex-direction: column; gap: 8px">
    {#if error}<p class="error" role="alert" style="margin: 0">{error}</p>{/if}
    <button class="primary" onclick={create} disabled={busy || !name.trim()}>Create game</button>
    <div class="hint" style="text-align: center">You'll get a code to share with the other players.</div>
  </div>
</main>

<style>
  .tag { height: 30px; padding: 0 10px; margin-right: 8px; border-radius: 999px; background: var(--primary); color: var(--on-primary); font-size: 12px; font-weight: 800; display: flex; align-items: center; }
  .card { overflow: hidden; }
  .line { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 8px 0 14px; min-height: 60px; }
  .line + .line { border-top: 1px solid var(--line-soft); }
  .strong { font-weight: 800; font-size: 16px; }
  .count { width: 32px; text-align: center; font-family: var(--display); font-weight: 800; font-size: 22px; }
  .step { width: 44px; height: 44px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--surface); display: flex; align-items: center; justify-content: center; }
  .step:disabled { opacity: 0.35; }
  .segment { display: flex; background: var(--well); border-radius: 12px; padding: 3px; }
  .segment button { height: 38px; min-width: 52px; padding: 0 12px; border-radius: 9px; border: none; background: transparent; font-weight: 700; font-size: 14px; }
  .segment button.on { background: var(--surface); }
  .toggle { padding-right: 14px; font-weight: 800; font-size: 15px; }
  .toggle input { width: 22px; height: 22px; accent-color: var(--ink); flex-shrink: 0; }
</style>
