<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { grow, ms, show } from '../lib/motion';
  import { names, plural } from '../../../shared/plural';
  import { MAX_PLAYERS } from '../../../shared/rules';
  import { api, ApiError } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { prompt } from '../lib/ask.svelte';
  import { live, watch } from '../lib/live.svelte';
  import { go, session, updates } from '../lib/state.svelte';
  import { getTheme, setTheme, type Theme } from '../lib/theme';

  type Summary = {
    id: string;
    status: 'lobby' | 'active' | 'finished';
    currentSeat: number;
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
  let menu = $state(false);

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

  let theme = $state<Theme>(getTheme());
  let tested = $state('');
  async function testPush() {
    tested = 'Sending…';
    tested = await api('/push/test', { method: 'POST' }).then(
      () => 'Sent. Check your notifications',
      () => "Couldn't send. Try again",
    );
  }

  async function rename() {
    const me = session.me;
    if (!me) return;
    menu = false;
    const displayName = await prompt({
      title: 'Change your name',
      body: 'This is what other players see in games and groups.',
      action: 'Save',
      input: { label: 'Display name', value: me.displayName, maxlength: 24 },
    });
    if (!displayName || displayName === me.displayName) return;
    await api('/me/settings', { method: 'PATCH', body: { displayName } }).then(
      () => (me.displayName = displayName),
      () => {},
    );
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.me = null;
    go('/');
  }

  const tag = (g: Summary) => (g.group ? `${g.group.name} · ` : '');
  const others = (g: Summary) => g.players.filter((p) => p.seat !== g.mySeat);
  // Games have no names: they're called by who else is in them.
  const title = (g: Summary) => names(others(g).map((p) => p.displayName)) || 'Waiting for players';
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
      <div class="mini-brand" aria-hidden="true"><span class="tile-face">T</span><span class="tile-face">R</span></div>
      <h1 class="h1" style="font-size: 34px">Tileroom</h1>
    </div>
    <button class="avatar" aria-label="Account" aria-expanded={menu} onclick={() => (menu = !menu)}>
      {session.me?.displayName[0]?.toUpperCase()}
    </button>
    {#if menu}
      <div class="card popover" role="menu" transition:grow>
        <span style="font-weight: 800">{session.me?.displayName}</span>
        <span class="hint">@{session.me?.username}</span>
        <div class="themes" role="radiogroup" aria-label="Theme">
          {#each ['system', 'light', 'dark'] as const as t (t)}
            <button
              role="radio"
              aria-checked={theme === t}
              class:on={theme === t}
              onclick={() => {
                theme = t;
                setTheme(t);
              }}>{t[0]!.toUpperCase() + t.slice(1)}</button
            >
          {/each}
        </div>
        <button class="secondary" role="menuitem" onclick={rename}>Change name</button>
        <button class="secondary" role="menuitem" onclick={testPush}>{tested || 'Send test notification'}</button>
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
          <span class="sub">{tag(g)}{scoreLine(g)}</span>
        </button>
      {/each}
    {/if}

    {#if games.waiting.length}
      <h2 class="label section">Waiting on others</h2>
      {#each games.waiting as g (g.id)}
        <button class="card game" in:show={{ y: 8 }} onclick={() => go(`/games/${g.id}`)}>
          <span class="name small">{title(g)}</span>
          <span class="sub">{tag(g)}{turnOf(g)}'s turn · {scoreLine(g)}</span>
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

    <h2 class="label section">Groups</h2>
    {#each groups as gr (gr.id)}
      <button class="card game" in:show={{ y: 8 }} onclick={() => go(`/groups/${gr.id}`)}>
        <span class="row">
          <span class="name small">{gr.name}</span>
          {#if gr.pendingVotes}<span class="pill">{plural(gr.pendingVotes, 'vote', 'votes')}</span>{/if}
        </span>
        <span class="sub">{plural(gr.memberCount, 'member', 'members')} · {plural(gr.wordCount, 'house word', 'house words')}</span>
      </button>
    {/each}
    {#if creating}
      <form onsubmit={createGroup} transition:slide={{ duration: ms(180) }} style="display: flex; flex-direction: column; gap: 8px">
        <label for="gn" class="label">Group name</label>
        <div style="display: flex; gap: 8px">
          <input id="gn" class="field" bind:value={groupName} placeholder="Friends" maxlength="30" autocomplete="off" />
          <button class="primary" style="width: 96px" disabled={!groupName.trim()}>Create</button>
        </div>
      </form>
    {:else}
      <button class="textbtn" style="align-self: flex-start" onclick={() => (creating = true)}>+ New group</button>
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
      <p class="lead" in:show style="margin-top: 32px; text-align: center">No games yet. Open one and share its code.</p>
    {/if}
  {/if}
</main>

<style>
  .mini-brand { display: flex; gap: 3px; }
  .mini-brand span { width: 26px; height: 26px; border-radius: 5px; font-size: 15px; }
  .avatar { width: 44px; height: 44px; border-radius: 22px; border: none; background: var(--p0-bg); color: var(--on-color); font-weight: 800; font-size: 16px; }
  .popover { transform-origin: top right; position: absolute; right: 0; top: 80px; z-index: 5; width: 220px; padding: 14px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px var(--shadow); }
  .themes { display: flex; background: var(--well); border-radius: 12px; padding: 3px; margin: 4px 0; }
  .themes button { flex: 1; height: 36px; border: none; border-radius: 9px; background: transparent; font-weight: 700; font-size: 13px; }
  .themes button.on { background: var(--surface); }
  .big { flex: 1; height: 56px; border-radius: 16px; font-weight: 800; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .dark { border: none; background: var(--primary); color: var(--on-primary); }
  .outline { border: 1.5px solid var(--ink); background: transparent; }
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
