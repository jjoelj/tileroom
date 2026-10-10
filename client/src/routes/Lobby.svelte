<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ms, show } from '../lib/motion';
  import { names, plural, turnAge } from '../../../shared/plural';
  import { MAX_PLAYERS } from '../../../shared/rules';
  import { api, ApiError } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { live, watch } from '../lib/live.svelte';
  import { go, session, updates } from '../lib/state.svelte';

  type Summary = {
    id: string;
    status: 'lobby' | 'active' | 'finished';
    currentSeat: number;
    turnNumber: number;
    turnStartedAt: number | null;
    mySeat: number;
    group: { id: string; name: string } | null;
    players: { seat: number; displayName: string; score: number }[];
  };
  type Games = { yourTurn: Summary[]; waiting: Summary[]; lobby: Summary[]; finished: Summary[] };

  let games = $state<Games | null>(null);
  type GroupSummary = { id: string; name: string; memberCount: number; wordCount: number; pendingVotes: number };
  let groups = $state<GroupSummary[]>([]);
  let creating = $state(false);
  let groupName = $state('');

  async function createGroup(e: SubmitEvent) {
    e.preventDefault();
    try {
      const g = await api<{ id: string }>('/groups', { method: 'POST', body: { name: groupName } });
      go(`/groups/${g.id}`);
    } catch (err) {
      sayError(err);
    }
  }
  let joining = $state(false);
  let code = $state('');

  const load = () =>
    Promise.all([
      api<Games>('/games')
        .then((g) => (games = g))
        .catch(() => {}),
      api<{ groups: GroupSummary[] }>('/groups')
        .then((g) => (groups = g.groups))
        .catch(() => {}),
    ]);

  $effect(() => {
    if (updates.n) void load();
  });

  $effect(() => {
    if (live.lobby) void load();
  });

  onMount(() => {
    void load();
    const unwatch = watch('lobby');
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unwatch();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  async function join(e: SubmitEvent) {
    e.preventDefault();
    // Group codes have 8 characters, game codes 6: one box takes both.
    if (code.replace(/[^0-9a-z]/gi, '').length === 8) return go(`/groups/join/${encodeURIComponent(code.trim())}`);
    try {
      const view = await api<{ id: string }>(`/join/${encodeURIComponent(code)}`, { method: 'POST' });
      go(`/games/${view.id}`);
    } catch (err) {
      sayError(err);
    }
  }

  const tag = (g: Summary) => (g.group ? `${g.group.name} · ` : '');
  const others = (g: Summary) => g.players.filter((p) => p.seat !== g.mySeat);
  // Games have no names: they're called by who else is in them.
  const title = (g: Summary) => names(others(g).map((p) => p.displayName)) || 'Waiting for players';
  const scoreLine = (g: Summary) =>
    g.players.map((p) => `${p.seat === g.mySeat ? 'You' : p.displayName} ${p.score}`).join(' · ');
  const since = (g: Summary) => (g.turnStartedAt === null ? '' : ` · ${turnAge(g.turnNumber, g.turnStartedAt, Date.now())}`);
  const turnOf = (g: Summary) => g.players.find((p) => p.seat === g.currentSeat)?.displayName ?? '';
  const result = (g: Summary) => {
    const best = Math.max(...g.players.map((p) => p.score));
    const winners = g.players.filter((p) => p.score === best);
    return winners.some((p) => p.seat === g.mySeat) ? `You won with ${best}` : `${winners.map((p) => p.displayName).join(' & ')} won with ${best}`;
  };
</script>

<main class="screen" style="padding: 0 16px 32px">
  <header style="padding: 28px 0 20px; display: flex; align-items: flex-end; justify-content: space-between; ">
    <div style="display: flex; flex-direction: column; gap: 4px">
      <div class="mini-brand" aria-hidden="true"><span class="tile-face">T</span><span class="tile-face">R</span></div>
      <h1 class="h1" style="font-size: 34px">Tileroom</h1>
    </div>
    <div style="display: flex; gap: 8px; align-items: center">
      <button class="iconbtn" aria-label="Leaderboard" title="Leaderboard" onclick={() => go('/leaderboard')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>
      </button>
      <button class="avatar" aria-label="Settings" onclick={() => go('/settings')}>
        {session.me?.displayName[0]?.toUpperCase()}
      </button>
    </div>
  </header>

  <div style="display: flex; gap: 8px">
    <button class="big dark" onclick={() => go('/new')}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      New game
    </button>
    <button class="big outline" aria-expanded={joining} onclick={() => (joining = !joining)}>Join game or group</button>
  </div>

  {#if joining}
    <form onsubmit={join} transition:slide={{ duration: ms(180) }} style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px">
      <label for="jc" class="label">Game or group code</label>
      <div style="display: flex; gap: 8px">
        <input id="jc" class="field" bind:value={code} placeholder="K7Q-4XM" autocomplete="off" autocapitalize="characters" spellcheck="false" style="letter-spacing: 0.1em; font-weight: 800" />
        <button class="primary" style="width: 96px" disabled={!code.trim()}>Join</button>
      </div>
    </form>
  {/if}

  {#if games}
    {#if games.yourTurn.length}
      <h2 class="label section">Your turn</h2>
      {#each games.yourTurn as g (g.id)}
        <button class="card game mine" in:show={{ y: 8 }} onclick={() => go(`/games/${g.id}`)}>
          <span class="row"><span class="name">{title(g)}</span><span class="pill">Play</span></span>
          <span class="sub">{tag(g)}{scoreLine(g)}{since(g)}</span>
        </button>
      {/each}
    {/if}

    <div class="row section">
      <h2 class="label" style="margin: 0">Groups</h2>
      <button class="newgroup" aria-expanded={creating} onclick={() => (creating = !creating)}>+ New group</button>
    </div>
    {#if creating}
      <form onsubmit={createGroup} transition:slide={{ duration: ms(180) }} style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px">
        <label for="gn" class="label">Group name</label>
        <div style="display: flex; gap: 8px">
          <input id="gn" class="field" bind:value={groupName} placeholder="Friends" maxlength="30" autocomplete="off" />
          <button class="primary" style="width: 96px" disabled={!groupName.trim()}>Create</button>
        </div>
      </form>
    {/if}
    {#each groups as gr (gr.id)}
      <button class="card game" in:show={{ y: 8 }} onclick={() => go(`/groups/${gr.id}`)}>
        <span class="row">
          <span class="name small">{gr.name}</span>
          {#if gr.pendingVotes}<span class="pill">{plural(gr.pendingVotes, 'vote', 'votes')}</span>{/if}
        </span>
        <span class="sub">{plural(gr.memberCount, 'member', 'members')} · {plural(gr.wordCount, 'house word', 'house words')}</span>
      </button>
    {:else}
      <p class="sub" style="margin: 0">Make a group for the people you play with: its own house words, and games only members can join.</p>
    {/each}

    {#if games.waiting.length}
      <h2 class="label section">Waiting on others</h2>
      {#each games.waiting as g (g.id)}
        <button class="card game" in:show={{ y: 8 }} onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{title(g)}</span>
          <span class="sub">{tag(g)}{turnOf(g)}'s turn · {scoreLine(g)}{since(g)}</span>
        </button>
      {/each}
    {/if}

    {#if games.lobby.length}
      <h2 class="label section">Starting soon</h2>
      {#each games.lobby as g (g.id)}
        <button class="card game" in:show={{ y: 8 }} onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{title(g)}</span>
          <span class="sub">{tag(g)}{plural(g.players.length, 'player', 'players')} joined · up to {MAX_PLAYERS}</span>
        </button>
      {/each}
    {/if}

    {#if games.finished.length}
      <h2 class="label section">Finished</h2>
      {#each games.finished as g (g.id)}
        <button class="game done" in:show={{ y: 8 }} onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{title(g)}</span>
          <span class="sub">{tag(g)}{result(g)}</span>
        </button>
      {/each}
    {/if}

    {#if !games.yourTurn.length && !games.waiting.length && !games.lobby.length && !games.finished.length}
      <p class="lead" in:show style="margin-top: 32px; text-align: center">No games yet. Start one in a group, or start one without a group and share its code.</p>
    {/if}
  {/if}
</main>

<style>
  .mini-brand { display: flex; gap: 3px; }
  .mini-brand span { width: 26px; height: 26px; border-radius: 5px; font-size: 15px; }
  .avatar { width: 44px; height: 44px; border-radius: 22px; border: none; background: var(--p0-bg); color: var(--on-color); font-weight: 800; font-size: 16px; }
  .big { flex: 1; height: 56px; border-radius: 16px; font-weight: 800; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .dark { border: none; background: var(--primary); color: var(--on-primary); }
  .newgroup { height: 44px; padding: 0 16px; border-radius: 22px; border: none; background: var(--primary); color: var(--on-primary); font-weight: 700; font-size: 13px; }
  .outline { border: 1.5px solid var(--ink); background: transparent; white-space: nowrap; padding: 0 12px; }
  .section { margin: 28px 0 10px; }
  .game { width: 100%; text-align: left; border: none; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .game.mine { padding: 16px; gap: 10px; outline: 2px solid var(--p0); }
  .game.done { background: transparent; border: 1.5px solid var(--line); border-radius: 16px; }
  .row { display: flex; justify-content: space-between; align-items: center; }
  .name { font-family: var(--display); font-weight: 800; font-size: 20px; }
  .name.small { font-family: var(--ui); font-size: 16px; }
  .sub { font-size: 13px; color: var(--muted); }
  .pill { font-size: 12px; font-weight: 800; color: var(--on-color); background: var(--p0-bg); padding: 4px 10px; border-radius: 999px; }
</style>
