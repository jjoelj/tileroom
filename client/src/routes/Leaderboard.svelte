<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Leaderboards (SPEC §4.12): Global and each of my groups; Wins or Points. A Rating board joins later as the default. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { plural } from '../../../shared/plural';
  import { api } from '../lib/api';
  import { show } from '../lib/motion';
  import { sayError } from '../lib/say.svelte';
  import { back, go, session } from '../lib/state.svelte';

  type Row = { userId: string; displayName: string; games: number; wins: number; points: number; best: number; listed: boolean };
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
    history.replaceState(history.state, '', id ? `/leaderboard?group=${id}` : '/leaderboard');
  }

  const other = $derived(by === 'wins' ? 'points' : 'wins');
  // My own row joins the list where it belongs: past the top 100, or opted out of the global board (only I see it).
  const sorted = $derived.by(() => {
    if (!data) return [];
    const me = data.me && !data.rows.some((r) => r.userId === data?.me?.userId) ? [data.me] : [];
    // ponytail: past the top 100 my rank shows as 101; fine for a few friends, fetch my real rank if boards grow
    return [...data.rows, ...me].sort((a, b) => b[by] - a[by] || b[other] - a[other]);
  });

  async function setGlobal(on: boolean) {
    const me = session.me;
    if (!me) return;
    await api('/me/settings', { method: 'PATCH', body: { showOnGlobal: on } }).then(() => {
      me.showOnGlobal = on;
      if (data?.me) data.me.listed = on;
    }, sayError);
  }
  const line = (r: Row) => (r.games ? `${plural(r.games, 'game', 'games')} · best ${r.best}` : 'No games yet');
  const unit = (r: Row) => (by === 'wins' ? (r.wins === 1 ? 'win' : 'wins') : 'pts');
</script>

<!-- One screen tall: tabs and the opt-out stay put, the list scrolls between them, and my row is sticky in it. -->
<main class="screen page">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back" onclick={() => back(from ? `/groups/${from}` : '/')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px">Leaderboard</h1>
  </header>

  <div class="body">
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
          <span class="who"
            ><span class="name">{r.userId === session.me?.id ? 'You' : r.displayName}</span><span class="hint">{r.listed ? line(r) : 'Hidden. Only you see this.'}</span></span
          >
          <span class="num">{r[by]}<span class="hint">{unit(r)}</span></span>
        </li>
      {/each}
    </ol>
    {#if !group}
      <label class="card toggle">
        <span class="who"><span style="font-weight: 700">Show me on the global leaderboard</span><span class="hint">Group leaderboards always show their members.</span></span>
        <input type="checkbox" checked={session.me?.showOnGlobal} onchange={(e) => setGlobal(e.currentTarget.checked)} />
      </label>
    {/if}
  </div>
</main>

<style>
  .chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
  .chips button { flex: 0 0 auto; height: 44px; padding: 0 16px; border-radius: 22px; border: 1.5px solid var(--line); background: transparent; font-weight: 700; font-size: 14px; white-space: nowrap; }
  .chips button.on { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
  .segment { display: flex; background: var(--well); border-radius: 12px; padding: 3px; }
  .segment button { flex: 1; height: 38px; border: none; border-radius: 9px; background: transparent; font-weight: 700; font-size: 14px; }
  .segment button.on { background: var(--surface); }
  .page { padding: 0; height: calc(100dvh - var(--foot) - env(safe-area-inset-top) - env(safe-area-inset-bottom)); min-height: 0; }
  .body { flex: 1; min-height: 0; padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
  ol { flex: 1; min-height: 0; overflow-y: auto; list-style: none; margin: 0 -4px; padding: 2px 4px; display: flex; flex-direction: column; gap: 8px; }
  ol > :global(*) { flex-shrink: 0; }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .toggle { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .toggle input { width: 24px; height: 24px; flex-shrink: 0; accent-color: var(--primary); }
  .row.mine { outline: 2px solid var(--p0); outline-offset: -2px; position: sticky; top: 0; bottom: 0; z-index: 1; box-shadow: 0 0 0 4px var(--ground); }
  .rank { width: 24px; font-family: var(--display); font-weight: 800; font-size: 18px; color: var(--muted); text-align: center; }
  .who { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num { display: flex; flex-direction: column; align-items: flex-end; font-family: var(--display); font-weight: 800; font-size: 22px; line-height: 1.1; }
</style>
