<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Leaderboards (SPEC §4.12): Global and each of my groups; Wins or Points. A Rating board joins later as the default. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { plural } from '../../../shared/plural';
  import { api } from '../lib/api';
  import { show } from '../lib/motion';
  import { sayError } from '../lib/say.svelte';
  import { go, session } from '../lib/state.svelte';

  type Row = { userId: string; displayName: string; games: number; wins: number; points: number; best: number };
  let groups = $state<{ id: string; name: string }[]>([]);
  const from = new URLSearchParams(location.search).get('group') ?? ''; // opened from a group page: back goes there
  let group = $state(from);
  let by = $state<'wins' | 'points'>('wins');
  let data = $state<{ rows: Row[]; me: Row | null } | null>(null);

  onMount(() => void api<{ groups: { id: string; name: string }[] }>('/groups').then((r) => (groups = r.groups), () => {}));

  $effect(() => {
    const g = group;
    data = null;
    void api<{ rows: Row[]; me: Row | null }>(`/leaderboard${g ? `?group=${encodeURIComponent(g)}` : ''}`).then((r) => {
      if (g === group) data = r;
    }, sayError);
  });

  function pick(id: string) {
    group = id;
    history.replaceState(null, '', id ? `/leaderboard?group=${id}` : '/leaderboard');
  }

  const other = $derived(by === 'wins' ? 'points' : 'wins');
  const sorted = $derived(data ? [...data.rows].sort((a, b) => b[by] - a[by] || b[other] - a[other]) : []);
  const line = (r: Row) => `${plural(r.games, 'game', 'games')} · best ${r.best}`;
  const unit = (r: Row) => (by === 'wins' ? (r.wins === 1 ? 'win' : 'wins') : 'pts');
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back" onclick={() => go(from ? `/groups/${from}` : '/')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px">Leaderboard</h1>
  </header>

  <div style="padding: 4px 16px 32px; display: flex; flex-direction: column; gap: 14px">
    <div class="chips" role="tablist" aria-label="Which leaderboard">
      <button role="tab" aria-selected={!group} class:on={!group} onclick={() => pick('')}>Global</button>
      {#each groups as g (g.id)}
        <button role="tab" aria-selected={group === g.id} class:on={group === g.id} onclick={() => pick(g.id)}>{g.name}</button>
      {/each}
    </div>
    <div class="segment" role="radiogroup" aria-label="Rank by">
      <button role="radio" aria-checked={by === 'wins'} class:on={by === 'wins'} onclick={() => (by = 'wins')}>Wins</button>
      <button role="radio" aria-checked={by === 'points'} class:on={by === 'points'} onclick={() => (by = 'points')}>Points</button>
    </div>

    {#if data && !sorted.length}
      <p class="hint" style="margin: 0">No finished games yet.</p>
    {/if}
    <ol>
      {#each sorted as r, i (r.userId)}
        <li class="card row" class:mine={r.userId === session.me?.id} in:show={{ y: 6 }}>
          <span class="rank">{i + 1}</span>
          <span class="who"><span class="name">{r.userId === session.me?.id ? 'You' : r.displayName}</span><span class="hint">{line(r)}</span></span>
          <span class="num">{r[by]}<span class="hint">{unit(r)}</span></span>
        </li>
      {/each}
    </ol>
    {#if data?.me}
      <div class="card row mine" aria-label="Your place">
        <span class="rank">…</span>
        <span class="who"><span class="name">You</span><span class="hint">{line(data.me)}</span></span>
        <span class="num">{data.me[by]}<span class="hint">{unit(data.me)}</span></span>
      </div>
    {/if}
    {#if !group}<p class="hint" style="margin: 0">You can leave the global board in Settings. Group boards always show their members.</p>{/if}
  </div>
</main>

<style>
  .chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
  .chips button { flex: 0 0 auto; height: 44px; padding: 0 16px; border-radius: 22px; border: 1.5px solid var(--line); background: transparent; font-weight: 700; font-size: 14px; white-space: nowrap; }
  .chips button.on { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
  .segment { display: flex; background: var(--well); border-radius: 12px; padding: 3px; }
  .segment button { flex: 1; height: 38px; border: none; border-radius: 9px; background: transparent; font-weight: 700; font-size: 14px; }
  .segment button.on { background: var(--surface); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .row.mine { outline: 2px solid var(--p0); outline-offset: -2px; }
  .rank { width: 24px; font-family: var(--display); font-weight: 800; font-size: 18px; color: var(--muted); text-align: center; }
  .who { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num { display: flex; flex-direction: column; align-items: flex-end; font-family: var(--display); font-weight: 800; font-size: 22px; line-height: 1.1; }
</style>
