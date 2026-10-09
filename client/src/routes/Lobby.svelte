<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { plural } from '../../../shared/plural';
  import { api, ApiError } from '../lib/api';
  import { go, session } from '../lib/state.svelte';

  type Summary = {
    id: string;
    name: string;
    status: 'lobby' | 'active' | 'finished';
    seatCount: number;
    currentSeat: number;
    mySeat: number;
    players: { seat: number; displayName: string; score: number }[];
  };
  type Games = { yourTurn: Summary[]; waiting: Summary[]; lobby: Summary[]; finished: Summary[] };

  let games = $state<Games | null>(null);
  let joining = $state(false);
  let code = $state('');
  let joinError = $state('');
  let menu = $state(false);

  const load = () =>
    api<Games>('/games')
      .then((g) => (games = g))
      .catch(() => {});

  onMount(() => {
    void load();
    // ponytail: polling until the WebSocket lands in milestone 4
    const timer = setInterval(load, 15_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  async function join(e: SubmitEvent) {
    e.preventDefault();
    joinError = '';
    try {
      const view = await api<{ id: string }>(`/join/${encodeURIComponent(code)}`, { method: 'POST' });
      go(`/games/${view.id}`);
    } catch (err) {
      joinError = err instanceof ApiError ? err.message : 'Check your connection and try again.';
    }
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.me = null;
    go('/');
  }

  const others = (g: Summary) => g.players.filter((p) => p.seat !== g.mySeat);
  const scoreLine = (g: Summary) =>
    g.players.map((p) => `${p.seat === g.mySeat ? 'You' : p.displayName} ${p.score}`).join(' · ');
  const turnOf = (g: Summary) => g.players.find((p) => p.seat === g.currentSeat)?.displayName ?? '';
  const result = (g: Summary) => {
    const best = Math.max(...g.players.map((p) => p.score));
    const winners = g.players.filter((p) => p.score === best);
    return winners.some((p) => p.seat === g.mySeat) ? `You won with ${best}` : `${winners.map((p) => p.displayName).join(' & ')} won with ${best}`;
  };
</script>

<main class="screen" style="padding: 0 16px 32px">
  <header style="padding: 28px 0 20px; display: flex; align-items: flex-end; justify-content: space-between; position: relative">
    <div style="display: flex; flex-direction: column; gap: 4px">
      <div class="mini-brand" aria-hidden="true"><span>T</span><span>R</span></div>
      <h1 class="h1" style="font-size: 34px">Tileroom</h1>
    </div>
    <button class="avatar" aria-label="Account" aria-expanded={menu} onclick={() => (menu = !menu)}>
      {session.me?.displayName[0]?.toUpperCase()}
    </button>
    {#if menu}
      <div class="card popover" role="menu">
        <span style="font-weight: 800">{session.me?.displayName}</span>
        <span class="hint">@{session.me?.username}</span>
        <button class="secondary" role="menuitem" onclick={signOut}>Sign out</button>
      </div>
    {/if}
  </header>

  <div style="display: flex; gap: 8px">
    <button class="big dark" onclick={() => go('/new')}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      Open game
    </button>
    <button class="big outline" aria-expanded={joining} onclick={() => (joining = !joining)}>Join with code</button>
  </div>

  {#if joining}
    <form onsubmit={join} style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px">
      <label for="jc" class="label">Game code</label>
      <div style="display: flex; gap: 8px">
        <input id="jc" class="field" bind:value={code} placeholder="K7Q-4XM" autocomplete="off" autocapitalize="characters" spellcheck="false" style="letter-spacing: 0.1em; font-weight: 800" />
        <button class="primary" style="width: 96px" disabled={!code.trim()}>Join</button>
      </div>
      {#if joinError}<span class="error" role="alert">{joinError}</span>{/if}
    </form>
  {/if}

  {#if games}
    {#if games.yourTurn.length}
      <h2 class="label section">Your turn</h2>
      {#each games.yourTurn as g (g.id)}
        <button class="card game mine" onclick={() => go(`/games/${g.id}`)}>
          <span class="row"><span class="name">{g.name}</span><span class="pill">Play</span></span>
          <span class="sub">{scoreLine(g)}</span>
        </button>
      {/each}
    {/if}

    {#if games.waiting.length}
      <h2 class="label section">Waiting on others</h2>
      {#each games.waiting as g (g.id)}
        <button class="card game" onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{g.name}</span>
          <span class="sub">{turnOf(g)}'s turn · {scoreLine(g)}</span>
        </button>
      {/each}
    {/if}

    {#if games.lobby.length}
      <h2 class="label section">Starting soon</h2>
      {#each games.lobby as g (g.id)}
        <button class="card game" onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{g.name}</span>
          <span class="sub">{g.players.length} of {plural(g.seatCount, 'seat', 'seats')} filled{others(g).length ? ` · with ${others(g).map((p) => p.displayName).join(', ')}` : ''}</span>
        </button>
      {/each}
    {/if}

    {#if games.finished.length}
      <h2 class="label section">Finished</h2>
      {#each games.finished as g (g.id)}
        <button class="game done" onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{g.name}</span>
          <span class="sub">{plural(g.players.length, 'player', 'players')} · {result(g)}</span>
        </button>
      {/each}
    {/if}

    {#if !games.yourTurn.length && !games.waiting.length && !games.lobby.length && !games.finished.length}
      <p class="lead" style="margin-top: 32px; text-align: center">No games yet. Open one and share its code.</p>
    {/if}
  {/if}
</main>

<style>
  .mini-brand { display: flex; gap: 3px; }
  .mini-brand span { width: 26px; height: 26px; border-radius: 5px; background: var(--tile); color: var(--tile-fg); font-weight: 800; font-size: 15px; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14); }
  .avatar { width: 44px; height: 44px; border-radius: 22px; border: none; background: var(--p0-bg); color: #fff; font-weight: 800; font-size: 16px; }
  .popover { position: absolute; right: 0; top: 80px; z-index: 5; width: 220px; padding: 14px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px rgba(22, 22, 26, 0.18); }
  .big { flex: 1; height: 56px; border-radius: 16px; font-weight: 800; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .dark { border: none; background: var(--ink); color: #fff; }
  .outline { border: 1.5px solid var(--ink); background: transparent; }
  .section { margin: 28px 0 10px; }
  .game { width: 100%; text-align: left; border: none; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .game.mine { padding: 16px; gap: 10px; outline: 2px solid var(--p0); }
  .game.done { background: transparent; border: 1.5px solid var(--line); border-radius: 16px; }
  .row { display: flex; justify-content: space-between; align-items: center; }
  .name { font-family: var(--display); font-weight: 800; font-size: 20px; }
  .name.small { font-family: var(--ui); font-size: 16px; }
  .sub { font-size: 13px; color: var(--muted); }
  .pill { font-size: 12px; font-weight: 800; color: #fff; background: var(--p0-bg); padding: 4px 10px; border-radius: 999px; }
</style>
