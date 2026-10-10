<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- A group (SPEC §4.10): its games, open votes on house words, the word list, members and settings. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ago, names, plural } from '../../../shared/plural';
  import { tally } from '../../../shared/votes';
  import { api, ApiError } from '../lib/api';
  import { confirm, prompt } from '../lib/ask.svelte';
  import { live, watch } from '../lib/live.svelte';
  import { clearNotifications } from '../lib/push';
  import { say, sayError } from '../lib/say.svelte';
  import { canShare, copy, shareText } from '../lib/share';
  import { show } from '../lib/motion';
  import { back, go, session, updates } from '../lib/state.svelte';

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
    majorityVotes: boolean;
    myRole: 'admin' | 'member';
    members: { userId: string; displayName: string; colorIndex: number; role: 'admin' | 'member' }[];
    words: { add: string[]; ban: string[] };
    proposals: Proposal[];
    history: Proposal[];
    morePast: boolean;
    games: { id: string; status: 'lobby' | 'active' | 'finished'; currentSeat: number; turnStartedAt: number | null; finishedAt: number | null; players: { userId: string; displayName: string; seat: number; score: number }[]; mine: boolean; joinCode: string | null }[];
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
    void clearNotifications(`group-${id}`);
    const unwatch = watch(`group:${id}`);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void load();
      void clearNotifications(`group-${id}`);
    };
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
    add: "It isn't in the word list. If the vote passes, it counts in this group's games.",
    ban: "It's a valid word. If the vote passes, it won't count in this group's games.",
    remove: "It's one of this group's added words. If the vote passes, it stops counting.",
    unban: "It's banned in this group. If the vote passes, it counts again.",
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
  const proposal = $derived(ready ? actionFor(ready) : null); // what Propose would do with the typed word

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

  // A new group game opens straight into its lobby with the default settings; the host changes them there.
  let starting = $state(false);
  const newGame = () => {
    starting = true;
    api<{ id: string }>('/games', { method: 'POST', body: { groupId: id } }).then((v) => go(`/games/${v.id}`), (e) => ((starting = false), sayError(e)));
  };

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

  let showCode = $state(false); // the group code is hidden until asked for (it's a key to the group)
  const inviteLink = $derived(group ? `${location.origin}/groups/join/${group.joinCode}` : '');

  async function rename() {
    if (!group) return;
    const name = await prompt({ title: 'Rename group', action: 'Rename', input: { label: 'Group name', value: group.name, maxlength: 30 } });
    if (name && name !== group.name) void act(`/groups/${id}/settings`, 'PATCH', { name });
  }

  /** Switching the voting rule settles open votes under the new one; ask first only if that passes any. */
  async function setMajority(on: boolean) {
    if (!group || on === group.majorityVotes) return;
    const passing = on
      ? group.proposals.filter((p) => tally(p.votes.length, p.votes.filter((v) => v.vote === 'yes').length, p.votes.filter((v) => v.vote === 'no').length, true) === 'passed').length
      : 0;
    if (passing) {
      const ok = await confirm({
        title: 'Switch to majority?',
        body: `${plural(passing, 'open vote already has', 'open votes already have')} more than half saying yes, so ${passing === 1 ? 'it passes' : 'they pass'} right away.`,
        action: 'Switch',
      });
      if (!ok) return;
    }
    void act(`/groups/${id}/settings`, 'PATCH', { majorityVotes: on });
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
        : `${g.players.find((p) => p.seat === g.currentSeat)?.displayName ?? ''}'s turn${g.turnStartedAt === null ? '' : ` · ${ago(Date.now() - g.turnStartedAt)}`}`;
  const current = $derived(group?.games.filter((g) => g.status !== 'finished') ?? []);
  // Past games: the group screen brings the latest few; Show more pages back from the last one shown.
  type GameRow = Detail['games'][number];
  let older = $state<GameRow[]>([]);
  let moreOlder = $state<boolean | null>(null); // null until a page is loaded: the group screen's flag applies
  const past = $derived.by(() => {
    const first = group?.games.filter((g) => g.status === 'finished') ?? [];
    const ids = new Set(first.map((g) => g.id));
    return [...first, ...older.filter((g) => !ids.has(g.id))];
  });
  const morePast = $derived(moreOlder ?? group?.morePast ?? false);
  let loadingPast = $state(false);
  async function showMore() {
    const last = past.at(-1);
    if (!last) return;
    loadingPast = true;
    try {
      const page = await api<{ games: GameRow[]; more: boolean }>(`/groups/${id}/past?at=${last.finishedAt}&id=${last.id}`);
      older = [...older, ...page.games];
      moreOlder = page.more;
    } catch (err) {
      sayError(err);
    } finally {
      loadingPast = false;
    }
  }
  /** "You won with 312", "Sam & Ben won with 280" (ties share it). */
  const result = (g: Detail['games'][number]) => {
    const best = Math.max(...g.players.map((p) => p.score));
    const top = g.players.filter((p) => p.score === best);
    return top.some((p) => p.userId === me) ? `You won with ${best}` : `${names(top.map((p) => p.displayName))} won with ${best}`;
  };
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
      <button class="iconbtn" aria-label="Back" onclick={() => back()}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div style="display: flex; flex-direction: column; min-width: 0">
        <h1 class="h1" style="font-size: 22px">{group.name}</h1>
        <span class="hint">{plural(group.members.length, 'member', 'members')} · {plural(group.words.add.length + group.words.ban.length, 'house word', 'house words')}</span>
      </div>
      <button class="iconbtn" style="margin-left: auto" aria-label="Leaderboard" title="Leaderboard" onclick={() => go(`/leaderboard?group=${group?.id}`)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>
      </button>
    </header>

    <!-- the code near the top, hidden by default; copying and sharing work without showing it -->
    <div class="card item codebar">
      <span class="grow">
        <span class="hint">Group code</span>
        <span class="code" aria-label={showCode ? group.joinCode : 'Hidden'}>{showCode ? group.joinCode : '••••-••••'}</span>
      </span>
      <button class="pill quiet" aria-pressed={showCode} onclick={() => (showCode = !showCode)}>{showCode ? 'Hide' : 'Show'}</button>
      {#if canShare}
        <button class="pill" onclick={() => shareText(`Join my Tileroom group ${group?.name} with code ${group?.joinCode}: ${inviteLink}`)}>Share</button>
      {:else}
        <button class="pill" onclick={() => copy(inviteLink, 'Link')}>Copy link</button>
      {/if}
    </div>

    <div class="row section">
      <h2 class="label" style="margin: 0">Games</h2>
      {#if current.length}<button class="pill" disabled={starting} onclick={newGame}>+ New game</button>{/if}
    </div>
    {#if !current.length}<button class="primary" disabled={starting} onclick={newGame}>New {group.name} game</button>{/if}
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
          <span class="hint">{p.proposedBy} proposed it · {plural(daysLeft(p), 'day', 'days')} left · {group.majorityVotes ? 'passes if more than half say yes' : 'passes only if everyone says yes'}</span>
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
      <div class="inline">
        <input class="field" bind:value={word} placeholder="Type a word to add or ban" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="15" aria-label="Word to propose" />
        <button class="primary" disabled={busy || !proposal}>Propose</button>
      </div>
      <!-- one line, always there: what Propose would do, so nothing below moves -->
      <span class="hint next" aria-live="polite">
        {#if ready && proposal}
          Proposes {ING[proposal]} {ready.word}. {WHY[proposal]}
        {:else if ready}
          {ready.word} is already up for a vote.
        {:else if typed && !wellFormed}
          Words are 2 to 15 letters, A to Z.
        {:else}
          Everyone in the group votes. It needs a yes from {group.majorityVotes ? 'more than half' : 'all'} of you.
        {/if}
      </span>
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

    {#if group.history.length}
      <details class="fold">
        <summary class="label">Past votes</summary>
        {#each group.history.slice(0, 8) as p (p.id)}
          <span class="hint past">{VERB[p.action]} {p.word} {outcome(p)}</span>
        {/each}
      </details>
    {/if}

    {#if past.length}
      <details class="fold">
        <summary class="label">Past games</summary>
        {#each past as g (g.id)}
          <div class="card item">
            <span class="grow">
              <span class="strong">{names(g.players.map((p) => (p.userId === me ? 'You' : p.displayName)))}</span>
              <span class="hint">{result(g)}</span>
            </span>
            <button class="pill quiet" onclick={() => go(`/games/${g.id}`)}>View</button>
          </div>
        {/each}
        {#if morePast}<button class="textbtn" disabled={loadingPast} onclick={showMore}>{loadingPast ? 'Loading…' : 'Show more'}</button>{/if}
      </details>
    {/if}

    <details class="fold">
      <summary class="label">Members ({group.members.length})</summary>
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
    </details>

    <!-- Everyone sees the settings; only admins change them. -->
    <details class="fold">
      <summary class="label">Settings</summary>
      {#if !admin}<span class="hint">Only admins can change these</span>{/if}
      {#if admin}
        <div class="card item">
          <span class="grow"><span class="hint">Name</span><span class="strong">{group.name}</span></span>
          <button class="pill quiet" disabled={busy} onclick={rename}>Rename</button>
        </div>
      {/if}
      <label class="card item toggle" class:readonly={!admin}>
        <span class="grow">
          <span class="strong">Spectators can see trays</span>
          <span class="hint">
            {group.spectatorsSeeRacks
              ? 'Members watching see every tray in games started while this is on. Turning it off hides them at once, in every game.'
              : 'Members watching see only the board. Turning this on applies to new games only, so players in running games are never exposed.'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={group.spectatorsSeeRacks}
          disabled={busy || !admin}
          onchange={(e) => act(`/groups/${id}/settings`, 'PATCH', { spectatorsSeeRacks: e.currentTarget.checked })}
        />
      </label>
      <div class="card item" class:readonly={!admin}>
        <span class="grow">
          <span class="strong">House word votes</span>
          <span class="hint">{group.majorityVotes ? 'Pass when more than half say yes' : 'Pass only when everyone says yes'}</span>
        </span>
        <div class="segment" role="radiogroup" aria-label="House word votes">
          {#each [[false, 'Unanimous'], [true, 'Majority']] as const as [on, name] (name)}
            <button role="radio" aria-checked={group.majorityVotes === on} class:on={group.majorityVotes === on} disabled={busy || !admin} onclick={() => setMajority(on)}>{name}</button>
          {/each}
        </div>
      </div>
      {#if admin}
        <div class="card item">
          <span class="grow"><span class="strong">Group code</span><span class="hint">A new code stops the old one working. Members stay.</span></span>
          <button class="pill quiet" disabled={busy} onclick={newCode}>New code</button>
        </div>
      {/if}
      <button class="textbtn leave" onclick={leave}>Leave {group.name}</button>
      <!-- a group's games show its name, so only a group with none can go -->
      {#if admin && !group.games.length}<button class="textbtn leave" style="margin-top: 0" onclick={remove}>Delete {group.name}</button>{/if}
    </details>
  </main>
{/if}

<style>
  .segment { display: flex; flex-shrink: 0; background: var(--well); border-radius: 12px; padding: 3px; }
  .segment button { height: 38px; padding: 0 12px; border-radius: 9px; border: none; background: transparent; font-weight: 700; font-size: 14px; }
  .segment button.on { background: var(--surface); }
  .segment button:disabled:not(.on) { opacity: 0.5; }
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
  .row { display: flex; align-items: center; justify-content: space-between; }
  .section.row { margin: 24px 0 8px; min-height: 44px; }
  .codebar { margin-top: 4px; }
  .codebar .code { font-size: 18px; }
  .propose { display: flex; flex-direction: column; gap: 6px; }
  .inline { display: flex; gap: 8px; }
  .inline .primary { width: auto; height: 54px; padding: 0 18px; flex-shrink: 0; }
  .propose .field { text-transform: uppercase; letter-spacing: 0.05em; }
  .propose .field::placeholder { text-transform: none; letter-spacing: normal; } /* only typed words are capitals */
  .next { min-height: 2.9em; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--surface); font-weight: 800; font-size: 13px; letter-spacing: 0.04em; }
  .list { padding: 4px 0; }
  .member { display: flex; align-items: center; gap: 12px; padding: 8px 14px; min-height: 52px; }
  .av { width: 34px; height: 34px; border-radius: 17px; color: var(--on-color); font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .code { font-family: var(--display); font-weight: 800; font-size: 22px; letter-spacing: 0.08em; }
  .toggle input { width: 22px; height: 22px; accent-color: var(--ink); flex-shrink: 0; }
  .readonly { opacity: 0.45; } /* the whole setting, not just the switch: it can't be changed here */
  .past { display: block; margin-top: 4px; }
  .leave { color: var(--bad); margin-top: 16px; display: block; }
  .fold { margin-top: 24px; }
  .fold + .fold { margin-top: 4px; }
  .fold summary { min-height: 44px; display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; }
  .fold summary::-webkit-details-marker { display: none; }
  .fold summary::after { content: ''; width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); margin-top: -4px; transition: transform 150ms; }
  .fold[open] summary::after { transform: rotate(225deg); margin-top: 4px; }
</style>
