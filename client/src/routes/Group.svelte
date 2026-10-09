<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- A group (SPEC §4.10): its games, open votes on house words, the word list, members and settings. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { names, plural } from '../../../shared/plural';
  import { api, ApiError } from '../lib/api';
  import { confirm, prompt } from '../lib/ask.svelte';
  import { live, watch } from '../lib/live.svelte';
  import { say, sayError } from '../lib/say.svelte';
  import { show } from '../lib/motion';
  import { go, session, updates } from '../lib/state.svelte';

  let { id }: { id: string } = $props();

  type Action = 'add' | 'ban' | 'remove' | 'unban';
  type Proposal = {
    id: string;
    word: string;
    action: Action;
    status: 'open' | 'passed' | 'rejected' | 'expired';
    proposedBy: string;
    closesAt: number;
    votes: { userId: string; displayName: string; vote: 'yes' | 'no' | null }[];
  };
  type Detail = {
    id: string;
    name: string;
    joinCode: string;
    spectatorsSeeRacks: boolean;
    myRole: 'admin' | 'member';
    members: { userId: string; displayName: string; colorIndex: number; role: 'admin' | 'member' }[];
    words: { add: string[]; ban: string[] };
    proposals: Proposal[];
    history: Proposal[];
    games: { id: string; status: 'lobby' | 'active' | 'finished'; currentSeat: number; players: { userId: string; displayName: string; seat: number }[]; mine: boolean; joinCode: string | null }[];
  };
  /** Where a word stands in this group (the lookup behind the propose button). */
  type Standing = { word: string; inBase: boolean; approved: 'add' | 'ban' | null; openProposal: { id: string; action: Action } | null };

  let group = $state<Detail | null>(null);
  let missing = $state(false);
  let busy = $state(false);
  let word = $state('');

  const me = $derived(session.me?.id);
  const admin = $derived(group?.myRole === 'admin');
  const VERB: Record<Action, string> = { add: 'Add', ban: 'Ban', remove: 'Remove', unban: 'Unban' };
  const DAY = 86_400_000;

  async function load() {
    try {
      group = await api<Detail>(`/groups/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing = true;
    }
  }

  $effect(() => {
    if (updates.n) void load(); // a push about this group arrived
  });

  $effect(() => {
    if (live.group) void load(); // someone joined, voted, renamed, started a game…
  });

  onMount(() => {
    void load();
    const unwatch = watch(`group:${id}`);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unwatch();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  /** Runs a write that returns the fresh group; shows the server's message on failure. */
  async function act(path: string, method: string, body?: unknown, done?: string) {
    busy = true;
    try {
      group = await api<Detail>(path, { method, body });
      if (done) say(done);
      return true;
    } catch (e) {
      sayError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  const vote = (p: Proposal, v: 'yes' | 'no') => act(`/proposals/${p.id}/vote`, 'POST', { vote: v });

  // ---- proposing: type a word and the one proposal that fits it appears (each word has one way in, one way out) ----
  const ING: Record<Action, string> = { add: 'adding', ban: 'banning', remove: 'removing', unban: 'unbanning' };
  const WHY: Record<Action, string> = {
    add: "It isn't in the word list. If everyone agrees, it counts in this group's games.",
    ban: "It's a valid word. If everyone agrees, it won't count in this group's games.",
    remove: "It's one of this group's added words. If everyone agrees, it stops counting.",
    unban: "It's banned in this group. If everyone agrees, it counts again.",
  };
  const actionFor = (s: Standing): Action | null =>
    s.openProposal ? null : s.approved === 'add' ? 'remove' : s.approved === 'ban' ? 'unban' : s.inBase ? 'ban' : 'add';

  const typed = $derived(word.trim().toUpperCase());
  const wellFormed = $derived(/^[A-Z]{2,15}$/.test(typed));
  let standing = $state<Standing | null>(null);
  // Look the word up quietly as it's typed (after a short pause), so the right button is ready.
  $effect(() => {
    const w = typed;
    if (!wellFormed) return void (standing = null);
    if (standing?.word === w) return;
    let current = true;
    const t = setTimeout(() => {
      api<Standing>(`/groups/${id}/words/${w}`)
        .then((s) => current && (standing = s))
        .catch(() => {});
    }, 250);
    return () => {
      current = false;
      clearTimeout(t);
    };
  });
  const ready = $derived(standing?.word === typed ? standing : null);

  async function propose(w: string, action: Action) {
    const ok = await act(`/groups/${id}/proposals`, 'POST', { word: w, action }, `Proposed. Everyone in ${group?.name} gets a vote.`);
    if (ok && w === typed) word = '';
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const action = ready && actionFor(ready);
    if (ready && action) void propose(ready.word, action);
  }

  /** Tapping one of the group's words: propose taking it back out. */
  async function proposeUndo(w: string, action: 'remove' | 'unban') {
    const ok = await confirm({ title: `Propose ${ING[action]} ${w}?`, body: WHY[action], action: `Propose ${ING[action]}` });
    if (ok) await propose(w, action);
  }

  async function joinGame(code: string) {
    busy = true;
    try {
      const view = await api<{ id: string }>(`/join/${encodeURIComponent(code)}`, { method: 'POST' });
      go(`/games/${view.id}`);
    } catch (e) {
      sayError(e);
      busy = false;
    }
  }

  const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;
  function share() {
    if (!group) return;
    const text = `Join my Tileroom group ${group.name} with code ${group.joinCode}: ${location.origin}/groups/join/${group.joinCode}`;
    if (canShare) navigator.share({ text }).catch(() => {});
    else
      navigator.clipboard?.writeText(text).then(
        () => say('Copied. Paste it to the people you want in the group.'),
        () => say(`Copy this: ${text}`),
      );
  }

  async function rename() {
    if (!group) return;
    const name = await prompt({ title: 'Rename group', action: 'Rename', input: { label: 'Group name', value: group.name, maxlength: 30 } });
    if (name && name !== group.name) void act(`/groups/${id}/settings`, 'PATCH', { name });
  }

  async function newCode() {
    const ok = await confirm({ title: 'Make a new code?', body: 'The old code stops working. Members stay in the group.', action: 'Make new code' });
    if (ok) void act(`/groups/${id}/code`, 'POST', undefined, 'New code made. The old one no longer works.');
  }

  /** Leaving or deleting: both end at the games list. */
  async function goodbye(path: string, method: 'DELETE') {
    try {
      await api(path, { method });
      go('/');
    } catch (e) {
      sayError(e);
    }
  }

  async function leave() {
    if (!group) return;
    const ok = await confirm({ title: `Leave ${group.name}?`, body: "Games you're playing carry on. You'll need the group code to come back.", action: 'Leave', danger: true });
    if (ok) await goodbye(`/groups/${id}/members/me`, 'DELETE');
  }

  async function remove() {
    if (!group) return;
    const ok = await confirm({
      title: `Delete ${group.name}?`,
      body: 'Its house words and votes are deleted for everyone. This can’t be undone.',
      action: 'Delete group',
      danger: true,
    });
    if (ok) await goodbye(`/groups/${id}`, 'DELETE');
  }

  const others = (g: Detail['games'][number]) => g.players.filter((p) => p.userId !== me).map((p) => p.displayName);
  const gameTitle = (g: Detail['games'][number]) => (g.mine ? names(others(g)) || 'Waiting for players' : names(g.players.map((p) => p.displayName)));
  const gameLine = (g: Detail['games'][number]) =>
    g.status === 'lobby'
      ? `Starting soon · ${plural(g.players.length, 'player', 'players')}`
      : g.status === 'finished'
        ? 'Finished'
        : `${g.players.find((p) => p.seat === g.currentSeat)?.displayName ?? ''}'s turn`;
  const current = $derived(group?.games.filter((g) => g.status !== 'finished') ?? []);
  const outcome = (p: Proposal) => (p.status === 'passed' ? 'passed' : p.status === 'expired' ? 'ran out of time' : 'was voted down');
  const daysLeft = (p: Proposal) => Math.max(1, Math.ceil((p.closesAt - Date.now()) / DAY));
</script>

{#if missing}
  <main class="screen">
    <p class="lead" style="margin-top: 64px">This group isn't available. You may have left it.</p>
    <button class="primary" style="margin-top: 24px" onclick={() => go('/')}>Back to games</button>
  </main>
{:else if group}
  <main class="screen" style="padding: 0 16px 32px">
    <header style="height: 56px; display: flex; align-items: center; gap: 4px; margin: 0 -8px">
      <button class="iconbtn" aria-label="Back to games" onclick={() => go('/')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div style="display: flex; flex-direction: column">
        <h1 class="h1" style="font-size: 22px">{group.name}</h1>
        <span class="hint">{plural(group.members.length, 'member', 'members')} · {plural(group.words.add.length + group.words.ban.length, 'house word', 'house words')}</span>
      </div>
      {#if admin}<button class="textbtn" style="margin-left: auto" disabled={busy} onclick={rename}>Rename</button>{/if}
    </header>

    <h2 class="label section">Games</h2>
    <button class="primary" onclick={() => go(`/new?group=${group?.id}`)}>New {group.name} game</button>
    {#each current as g (g.id)}
      <div class="card item">
        <span class="grow">
          <span class="strong">{gameTitle(g)}</span>
          <span class="hint">{gameLine(g)}</span>
        </span>
        {#if g.mine}
          <button class="pill" onclick={() => go(`/games/${g.id}`)}>Open</button>
        {:else if g.status === 'lobby' && g.joinCode}
          <button class="pill" disabled={busy} onclick={() => joinGame(g.joinCode!)}>Join</button>
        {:else}
          <button class="pill quiet" onclick={() => go(`/games/${g.id}`)}>Watch</button>
        {/if}
      </div>
    {/each}

    {#if group.proposals.length}
      <h2 class="label section">Votes</h2>
      {#each group.proposals as p (p.id)}
        {@const mine = p.votes.find((v) => v.userId === me)?.vote}
        <div class="card proposal" in:show={{ y: 6 }}>
          <span class="strong">{VERB[p.action]} {p.word}</span>
          <span class="hint">{p.proposedBy} proposed it · {plural(daysLeft(p), 'day', 'days')} left · passes only if everyone says yes</span>
          <div class="votes">
            {#each p.votes as v (v.userId)}
              <span class="vote" class:yes={v.vote === 'yes'} class:no={v.vote === 'no'}>
                {v.vote === 'yes' ? '✓' : v.vote === 'no' ? '✗' : '…'}
                {v.userId === me ? 'You' : v.displayName}
              </span>
            {/each}
          </div>
          {#if mine === null || mine === undefined}
            <div class="pair">
              <button class="secondary" disabled={busy} onclick={() => vote(p, 'no')}>No</button>
              <button class="primary" style="height: 52px" disabled={busy} onclick={() => vote(p, 'yes')}>Yes</button>
            </div>
          {:else if mine === 'yes'}
            <button class="textbtn" disabled={busy} onclick={() => vote(p, 'no')}>Change my vote to no</button>
          {/if}
        </div>
      {/each}
    {/if}

    <h2 class="label section">House words</h2>
    <form class="propose" onsubmit={submit}>
      <input class="field" bind:value={word} placeholder="Type a word to add or ban" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="15" aria-label="Word to propose" />
      <!-- fixed height: the button and its note fill in without moving anything below -->
      <div class="next" aria-live="polite">
        {#if ready}
          {@const a = actionFor(ready)}
          {#if a}
            <button class="primary" disabled={busy}>Propose {ING[a]} {ready.word}</button>
            <span class="hint">{WHY[a]}</span>
          {:else}
            <button class="primary" disabled>Propose {ready.word}</button>
            <span class="hint">{ready.word} is already up for a vote below.</span>
          {/if}
        {:else}
          <button class="primary" disabled>{wellFormed ? `Propose ${typed}` : 'Propose a word'}</button>
          <span class="hint">{typed && !wellFormed ? 'Words are 2 to 15 letters, A to Z.' : 'Everyone in the group votes. It needs a yes from all of you.'}</span>
        {/if}
      </div>
    </form>
    {#if group.words.add.length}
      <span class="sub">Added <span class="hint">· tap to propose removing</span></span>
      <div class="chips">{#each group.words.add as w (w)}<button class="chip" onclick={() => proposeUndo(w, 'remove')}>{w}</button>{/each}</div>
    {/if}
    {#if group.words.ban.length}
      <span class="sub">Banned <span class="hint">· tap to propose unbanning</span></span>
      <div class="chips">{#each group.words.ban as w (w)}<button class="chip" onclick={() => proposeUndo(w, 'unban')}>{w}</button>{/each}</div>
    {/if}
    {#if !group.words.add.length && !group.words.ban.length}
      <span class="hint">No house words yet. Games here use the standard list until a proposal passes.</span>
    {/if}

    <h2 class="label section">Members</h2>
    <div class="card list">
      {#each group.members as m (m.userId)}
        <div class="member">
          <span class="av" style="background: var(--p{m.colorIndex % 6}-bg)">{m.displayName[0]?.toUpperCase() ?? ''}</span>
          <span class="grow strong">{m.userId === me ? 'You' : m.displayName}</span>
          {#if m.role === 'admin'}<span class="hint">Admin</span>{/if}
          {#if admin && m.userId !== me}
            <button class="textbtn" disabled={busy} onclick={() => act(`/groups/${id}/members/${m.userId}/role`, 'PUT', { role: m.role === 'admin' ? 'member' : 'admin' })}>
              {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
    <div class="card item">
      <span class="grow">
        <span class="hint">Group code</span>
        <span class="code">{group.joinCode}</span>
      </span>
      <button class="pill" onclick={share}>{canShare ? 'Share' : 'Copy'}</button>
    </div>
    {#if admin}<button class="textbtn" disabled={busy} onclick={newCode}>Make a new code</button>{/if}

    <!-- Everyone sees the settings; only admins change them. -->
    <h2 class="label section">Settings</h2>
    {#if !admin}<span class="hint">Only admins can change these</span>{/if}
    <label class="card item toggle" class:readonly={!admin}>
      <span class="grow">
        <span class="strong">Spectators can see trays</span>
        <span class="hint">{group.spectatorsSeeRacks ? 'Applies to games started from now on. Turning it off applies at once.' : 'Members watching a game see only the board'}</span>
      </span>
      <input
        type="checkbox"
        checked={group.spectatorsSeeRacks}
        disabled={busy || !admin}
        onchange={(e) => act(`/groups/${id}/settings`, 'PATCH', { spectatorsSeeRacks: e.currentTarget.checked })}
      />
    </label>

    {#if group.history.length}
      <h2 class="label section">Past votes</h2>
      {#each group.history.slice(0, 8) as p (p.id)}
        <span class="hint past">{VERB[p.action]} {p.word} {outcome(p)}</span>
      {/each}
    {/if}

    <button class="textbtn leave" onclick={leave}>Leave {group.name}</button>
    <!-- a group's games show its name, so only a group with none can go -->
    {#if admin && !group.games.length}<button class="textbtn leave" style="margin-top: 0" onclick={remove}>Delete {group.name}</button>{/if}
  </main>
{/if}

<style>
  .section { margin: 24px 0 8px; }
  .item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-top: 8px; min-height: 60px; }
  .grow { flex-grow: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .strong { font-weight: 800; }
  .sub { font-weight: 800; margin-top: 12px; }
  .pill { min-height: 40px; padding: 0 14px; border-radius: 999px; border: none; background: var(--primary); color: var(--on-primary); font-weight: 800; font-size: 13px; flex-shrink: 0; }
  .pill.quiet { background: var(--well); color: var(--ink); }
  .pill:disabled { opacity: 0.4; }
  .proposal { padding: 14px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
  .votes { display: flex; flex-wrap: wrap; gap: 6px; }
  .vote { padding: 4px 10px; border-radius: 999px; background: var(--well); font-size: 13px; font-weight: 700; color: var(--muted); }
  .vote.yes { color: var(--ok); }
  .vote.no { color: var(--bad); }
  .pair { display: flex; gap: 8px; }
  .propose { display: flex; flex-direction: column; gap: 8px; }
  .propose .field { text-transform: uppercase; letter-spacing: 0.05em; }
  .propose .field::placeholder { text-transform: none; letter-spacing: normal; } /* only typed words are capitals */
  .next { min-height: 92px; display: flex; flex-direction: column; gap: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--surface); font-weight: 800; font-size: 13px; letter-spacing: 0.04em; }
  .list { padding: 4px 0; }
  .member { display: flex; align-items: center; gap: 12px; padding: 8px 14px; min-height: 52px; }
  .av { width: 34px; height: 34px; border-radius: 17px; color: var(--on-color); font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .code { font-family: var(--display); font-weight: 800; font-size: 22px; letter-spacing: 0.08em; }
  .toggle input { width: 22px; height: 22px; accent-color: var(--ink); flex-shrink: 0; }
  .toggle.readonly { opacity: 0.45; } /* the whole setting, not just the switch: it can't be changed here */
  .past { display: block; margin-top: 4px; }
  .leave { color: var(--bad); margin-top: 24px; }
</style>
