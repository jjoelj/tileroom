<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { plural } from '../../../shared/plural';
  import { previewPlay } from '../../../shared/rules';
  import { VALUES } from '../../../shared/tiles';
  import type { GameView, PublicMove } from '../../../shared/types';
  import { api, ApiError } from '../lib/api';
  import Board, { type PendingTile } from '../lib/Board.svelte';
  import { invalidWords } from '../lib/dict';
  import { go, session } from '../lib/state.svelte';

  let { id }: { id: string } = $props();

  let view = $state<GameView | null>(null);
  let missing = $state(false);
  let pending = $state<PendingTile[]>([]);
  let order = $state<number[]>([]); // display order of rack slots (Shuffle permutes it)
  let selected = $state<number | null>(null);
  let blankAt = $state<{ r: number; c: number; slot: number } | null>(null);
  let swapOpen = $state(false);
  let swapPick = $state<number[]>([]);
  let menuOpen = $state(false);
  let zoom = $state(false);
  let busy = $state(false);
  let message = $state('');
  let invalid = $state<string[] | null>(null);

  const storeKey = $derived(`tileroom:pending:${id}`);
  const rack = $derived(view?.myRack ?? []);
  const myTurn = $derived(view?.status === 'active' && view.currentSeat === view.mySeat);
  const nameOf = (seat: number) => (seat === view?.mySeat ? 'You' : (view?.players[seat]?.displayName ?? ''));

  /** Applies a fresh view, keeping placed tiles while they still fit the rack and board. */
  function apply(v: GameView) {
    const rackChanged = !view || (view.myRack ?? []).join() !== (v.myRack ?? []).join();
    view = v;
    if (rackChanged) {
      order = (v.myRack ?? []).map((_, i) => i);
      pending = restore(v);
      selected = null;
    } else {
      pending = pending.filter((p) => !v.board[p.r]![p.c]);
    }
  }

  // Pending placements survive a reload (SPEC §9.2). Only the user's own tiles are stored.
  function restore(v: GameView): PendingTile[] {
    try {
      const saved: PendingTile[] = JSON.parse(localStorage.getItem(storeKey) ?? '[]');
      const ok = saved.every((p) => !v.board[p.r]?.[p.c] && v.myRack?.[p.slot] === (p.blank ? '?' : p.letter));
      return ok ? saved : [];
    } catch {
      return [];
    }
  }
  $effect(() => {
    localStorage.setItem(storeKey, JSON.stringify(pending));
  });

  async function load() {
    try {
      apply(await api<GameView>(`/games/${id}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing = true;
    }
  }

  onMount(() => {
    void load();
    // ponytail: polling until the WebSocket lands in milestone 4
    const timer = setInterval(() => !myTurn && document.visibilityState === 'visible' && load(), 10_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  // ---- live preview (SPEC §9.2) ----
  const preview = $derived(view && pending.length ? previewPlay(view.board, pending, () => true) : null);
  $effect(() => {
    const p = preview;
    invalid = null;
    if (!p?.ok || !view) return;
    invalidWords(
      p.words.map((w) => w.word),
      view.expandedWords,
    ).then((bad) => {
      if (preview === p) invalid = bad;
    });
  });
  const allValid = $derived(!!preview?.ok && invalid !== null && invalid.length === 0);
  const outlines = $derived(preview?.ok && invalid ? preview.words.filter((w) => !invalid!.includes(w.word)) : []);
  const bubble = $derived(preview?.ok ? { ...preview.anchor, score: preview.score, valid: allValid } : null);
  const problem = $derived(
    invalid?.length
      ? `${invalid.join(', ')} ${invalid.length > 1 ? "aren't" : "isn't"} in this game's word list`
      : preview && !preview.ok
        ? preview.reason
        : '',
  );

  // ---- placing tiles (tap to place; drag and drop comes next) ----
  function tapSlot(slot: number) {
    if (pending.some((p) => p.slot === slot)) return;
    selected = selected === slot ? null : slot;
  }

  function tapCell(r: number, c: number) {
    const placed = pending.findIndex((p) => p.r === r && p.c === c);
    if (placed >= 0) {
      pending.splice(placed, 1);
      return;
    }
    if (selected === null || !view || view.status !== 'active' || view.board[r]![c]) return;
    const letter = rack[selected]!;
    if (letter === '?') blankAt = { r, c, slot: selected };
    else pending.push({ r, c, letter, blank: false, slot: selected });
    selected = null;
  }

  function pickBlank(letter: string) {
    if (blankAt) pending.push({ ...blankAt, letter, blank: true });
    blankAt = null;
  }

  function shuffle() {
    const o = [...order];
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); // cosmetic only, not game randomness
      [o[i], o[j]] = [o[j]!, o[i]!];
    }
    order = o;
  }

  const recall = () => {
    pending = [];
    selected = null;
  };

  // ---- moves ----
  async function send(body: object) {
    if (!view) return;
    busy = true;
    message = '';
    try {
      const v = await api<GameView>(`/games/${id}/moves`, { method: 'POST', body: { turnNumber: view.turnNumber, ...body } });
      pending = [];
      apply(v);
    } catch (e) {
      message = e instanceof ApiError ? e.message : 'Check your connection and try again.';
      if (e instanceof ApiError && e.status === 409) await load();
      if (e instanceof ApiError && e.status === 410) missing = true;
    } finally {
      busy = false;
    }
  }

  const play = () => send({ type: 'play', tiles: pending.map(({ r, c, letter, blank }) => ({ r, c, letter, blank })) });
  const pass = () => {
    menuOpen = false;
    if (confirm('Pass this turn?')) void send({ type: 'pass' });
  };
  async function swap() {
    const letters = swapPick.map((i) => rack[i]!);
    swapOpen = false;
    swapPick = [];
    await send({ type: 'swap', swap: letters });
  }

  async function nudge() {
    menuOpen = false;
    try {
      await api(`/games/${id}/nudge`, { method: 'POST' });
      message = `Nudged ${nameOf(view!.currentSeat)}.`;
    } catch (e) {
      message = e instanceof ApiError ? e.message : 'Check your connection and try again.';
    }
  }

  async function start() {
    busy = true;
    try {
      apply(await api<GameView>(`/games/${id}/start`, { method: 'POST' }));
    } catch (e) {
      message = e instanceof ApiError ? e.message : 'Check your connection and try again.';
    } finally {
      busy = false;
    }
  }

  function share() {
    if (!view?.joinCode) return;
    const text = `Join my Tileroom game: code ${view.joinCode} — ${location.origin}/join/${view.joinCode}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => (message = 'Copied the invite.'));
  }

  const describe = (m: PublicMove) =>
    m.type === 'play'
      ? `${nameOf(m.seat)} played ${m.words[0]?.word} for ${m.score}`
      : m.type === 'swap'
        ? `${nameOf(m.seat)} swapped ${plural(m.count, 'tile', 'tiles')}`
        : `${nameOf(m.seat)} passed`;

  const standings = $derived(view ? [...view.players].sort((a, b) => b.score - a.score) : []);
</script>

{#if missing}
  <main class="screen">
    <p class="lead" style="margin-top: 64px">This game isn't available. It may have been cancelled after 7 days without a move.</p>
    <button class="primary" style="margin-top: 24px" onclick={() => go('/')}>Back to games</button>
  </main>
{:else if view}
  <main class="game">
    <header>
      <button class="iconbtn" aria-label="Back to games" onclick={() => go('/')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div class="title">
        <h1>{view.name}</h1>
        <span>Open game{view.expandedWords ? ' · expanded word list' : ''}</span>
      </div>
      {#if view.status === 'active'}
        <button class="iconbtn" aria-label="Game menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
        </button>
      {:else}
        <span style="width: 44px"></span>
      {/if}
      {#if menuOpen}
        <div class="card popover" role="menu">
          {#if myTurn}
            <button class="secondary" role="menuitem" disabled={busy} onclick={pass}>Pass this turn</button>
          {:else}
            <button class="secondary" role="menuitem" onclick={nudge}>Nudge {nameOf(view.currentSeat)}</button>
          {/if}
        </div>
      {/if}
    </header>

    {#if view.status === 'lobby'}
      <section class="lobby">
        <span class="label">Game code</span>
        <div class="code">{view.joinCode}</div>
        <button class="secondary" onclick={share}>Share code</button>
        <div class="card seats">
          {#each Array.from({ length: view.seatCount }, (_, i) => view!.players[i]) as p, i (i)}
            <div class="seat">
              <span class="av" style="background: {p ? `var(--p${p.colorIndex % 6}-bg)` : 'transparent'}" class:open={!p}>{p?.displayName[0]?.toUpperCase() ?? ''}</span>
              <span style="flex-grow: 1; font-weight: 700; color: {p ? 'var(--ink)' : 'var(--muted)'}">{p ? (p.userId === session.me?.id ? 'You' : p.displayName) : 'Open seat'}</span>
              {#if p?.userId === view.hostUserId}<span class="hint">Host</span>{/if}
            </div>
          {/each}
        </div>
        {#if view.hostUserId === session.me?.id}
          <button class="primary" disabled={busy || view.players.length < 2} onclick={start}>
            {view.players.length < view.seatCount ? `Start with ${plural(view.players.length, 'player', 'players')}` : 'Start game'}
          </button>
          <span class="hint" style="text-align: center">
            {view.players.length < 2
              ? 'Waiting for at least one more player'
              : view.players.length < view.seatCount
                ? `${plural(view.seatCount - view.players.length, 'seat is', 'seats are')} still open: start now and they close, or wait`
                : "Everyone's here"}
          </span>
        {:else}
          <span class="hint" style="text-align: center">Waiting for the host to start</span>
        {/if}
        {#if message}<p class="hint" role="status">{message}</p>{/if}
      </section>
    {:else}
      <section class="strip" aria-label="Scores, in turn order">
        {#each view.players as p (p.seat)}
          <div class="pc" class:on={view.status === 'active' && p.seat === view.currentSeat}>
            <div class="pn" style="color: var(--p{p.colorIndex % 6})">
              <span class="dot"></span>{p.seat === view.mySeat ? 'You' : p.displayName}
              {#if view.winnerSeats?.includes(p.seat)}<svg role="img" aria-label="winner" width="14" height="14" viewBox="0 0 24 24" fill="#C9A227"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>{/if}
            </div>
            <div class="sc">{p.score}</div>
          </div>
        {/each}
      </section>

      <div class="status">
        <span>
          {#if view.status === 'finished'}
            Game over
          {:else}
            {view.lastMove ? `${describe(view.lastMove)} · ` : ''}{myTurn ? 'Your turn' : `${nameOf(view.currentSeat)} is next`}
          {/if}
        </span>
        <span>{view.finalRoundAfter !== null && view.status === 'active' ? 'Last round' : `${view.bagCount} in bag`}</span>
      </div>

      <div style="position: relative">
        <Board
          board={view.board}
          {pending}
          lastTurn={view.lastMove?.type === 'play' ? view.lastMove.turn : null}
          {outlines}
          {bubble}
          {zoom}
          onCell={tapCell}
        />
        <button class="zoombtn" aria-label={zoom ? 'Zoom out' : 'Zoom in'} aria-pressed={zoom} onclick={() => (zoom = !zoom)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M8 11h6" />{#if !zoom}<path d="M11 8v6" />{/if}</svg>
        </button>
      </div>

      <p class="problem" role="status">{message || problem || (view.status === 'active' ? 'Tap a tile, then a square · tap a placed tile to take it back' : '')}</p>

      {#if view.status === 'finished'}
        <section class="final">
          <h2 class="h1" style="font-size: 26px">
            {view.winnerSeats?.includes(view.mySeat ?? -1) ? (view.winnerSeats.length > 1 ? 'You tied for the win!' : 'You won!') : `${nameOf(standings[0]!.seat)} won`}
          </h2>
          {#each standings as p (p.seat)}
            <div class="row">
              <span>{p.seat === view.mySeat ? 'You' : p.displayName}</span>
              <span class="hint">{view.finalRacks?.find((f) => f.seat === p.seat)?.rack.join(' ') || 'no tiles left'}</span>
              <b>{p.score}</b>
            </div>
          {/each}
          <button class="primary" onclick={() => go('/')}>Back to games</button>
        </section>
      {:else}
        <div class="rack" aria-label="Your tiles">
          {#each order as slot (slot)}
            {@const used = pending.some((p) => p.slot === slot)}
            {#if used}
              <span class="rk empty" aria-hidden="true"></span>
            {:else}
              <button class="rk" class:sel={selected === slot} aria-pressed={selected === slot} aria-label={rack[slot] === '?' ? 'Blank tile' : `Tile ${rack[slot]}, ${plural(VALUES[rack[slot]!]!, 'point', 'points')}`} onclick={() => tapSlot(slot)}>
                <span class="ch">{rack[slot] === '?' ? '' : rack[slot]}</span>
                {#if rack[slot] !== '?'}<span class="pt">{VALUES[rack[slot]!]}</span>{/if}
              </button>
            {/if}
          {/each}
        </div>

        <div class="actions">
          <button class="tool" aria-label="Shuffle tiles" onclick={shuffle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
          </button>
          <button class="tool" aria-label="Return placed tiles" disabled={!pending.length} onclick={recall}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>
          </button>
          <button class="tool wide" disabled={!myTurn || busy || view.bagCount === 0} onclick={() => (swapOpen = true)}>Swap</button>
          <button class="playbtn" disabled={!myTurn || !allValid || busy} onclick={play}>
            {#if allValid}<span class="ready"></span>{/if}
            Play{preview?.ok ? ` · ${preview.score}` : ''}
          </button>
        </div>
      {/if}
    {/if}
  </main>

  {#if blankAt}
    <div class="sheet-bg" role="presentation" onclick={() => (blankAt = null)}></div>
    <div class="sheet" role="dialog" aria-label="Choose a letter for the blank">
      <span class="label">Blank tile: pick a letter</span>
      <div class="letters">
        {#each 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' as l (l)}
          <button onclick={() => pickBlank(l)}>{l}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if swapOpen}
    <div class="sheet-bg" role="presentation" onclick={() => (swapOpen = false)}></div>
    <div class="sheet" role="dialog" aria-label="Swap tiles">
      <span class="label">Pick tiles to swap</span>
      <div class="rack" style="padding: 8px 0">
        {#each rack as letter, i (i)}
          <button
            class="rk"
            class:sel={swapPick.includes(i)}
            aria-pressed={swapPick.includes(i)}
            aria-label={letter === '?' ? 'Blank tile' : `Tile ${letter}`}
            onclick={() => (swapPick = swapPick.includes(i) ? swapPick.filter((x) => x !== i) : [...swapPick, i])}
          >
            <span class="ch">{letter === '?' ? '' : letter}</span>
          </button>
        {/each}
      </div>
      <span class="hint">{plural(view.bagCount, 'tile', 'tiles')} in the bag. Swapping scores 0.</span>
      <button class="primary" disabled={!swapPick.length || swapPick.length > view.bagCount} onclick={swap}>
        {swapPick.length ? `Swap ${plural(swapPick.length, 'tile', 'tiles')}` : 'Swap'}
      </button>
    </div>
  {/if}
{/if}

<style>
  .game { max-width: 480px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; }
  header { height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 8px; position: relative; }
  .title { flex-grow: 1; display: flex; flex-direction: column; align-items: center; min-width: 0; }
  .title h1 { margin: 0; font-family: var(--display); font-weight: 800; font-size: 18px; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .title span { font-size: 12px; font-weight: 600; color: var(--muted); }
  .popover { position: absolute; right: 8px; top: 52px; z-index: 10; width: 220px; padding: 12px; box-shadow: 0 10px 30px rgba(22, 22, 26, 0.18); }
  .strip { display: flex; gap: 6px; padding: 0 8px 10px; overflow-x: auto; }
  .pc { flex: 0 0 auto; min-width: 68px; background: var(--surface); border-radius: 12px; padding: 7px 10px; display: flex; flex-direction: column; gap: 1px; }
  .pc.on { outline: 2px solid var(--p0); outline-offset: -2px; }
  .pn { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 4px; background: currentColor; }
  .sc { font-family: var(--display); font-weight: 800; font-size: 22px; line-height: 1.1; }
  .status { display: flex; justify-content: space-between; gap: 8px; padding: 0 12px 6px; font-size: 12px; color: var(--muted); font-weight: 600; }
  .zoombtn { position: absolute; right: 14px; bottom: 6px; width: 44px; height: 44px; border-radius: 22px; border: none; background: rgba(22, 22, 26, 0.82); color: #fff; display: flex; align-items: center; justify-content: center; z-index: 4; }
  .problem { margin: 10px 12px 0; min-height: 16px; font-size: 12px; font-weight: 600; color: var(--muted); text-align: center; }
  .rack { display: flex; justify-content: center; gap: 6px; padding: 18px 8px 12px; }
  .rk { position: relative; width: 44px; height: 48px; border-radius: 8px; border: none; background: var(--tile); color: var(--tile-fg); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.16); display: flex; align-items: center; justify-content: center; transition: transform 0.12s; }
  .rk.sel { outline: 3px solid var(--p0); outline-offset: 2px; transform: translateY(-6px); }
  .rk.empty { background: transparent; border: 1.5px dashed #c9c5b8; box-shadow: none; }
  .rk .ch { font-size: 24px; font-weight: 800; }
  .rk .pt { position: absolute; right: 5px; bottom: 3px; font-size: 10px; font-weight: 700; }
  .actions { margin-top: auto; padding: 0 8px 20px; display: flex; gap: 8px; align-items: center; }
  .tool { width: 48px; height: 52px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--surface); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .tool.wide { width: auto; padding: 0 14px; }
  .tool:disabled { opacity: 0.4; }
  .playbtn { height: 52px; flex-grow: 1; border-radius: 14px; border: none; background: var(--ink); color: #fff; font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .playbtn:disabled { opacity: 0.35; }
  .ready { width: 8px; height: 8px; border-radius: 4px; background: var(--valid); }
  .lobby { padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 12px; }
  .code { font-family: var(--display); font-weight: 800; font-size: 44px; letter-spacing: 0.08em; text-align: center; padding: 8px 0; }
  .seats { overflow: hidden; }
  .seat { display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 52px; }
  .seat + .seat { border-top: 1px solid var(--line-soft); }
  .av { width: 34px; height: 34px; border-radius: 17px; color: #fff; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .av.open { border: 1.5px dashed #b9b5a8; }
  .final { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .final .row { display: flex; align-items: center; gap: 12px; background: var(--surface); border-radius: 12px; padding: 10px 14px; }
  .final .row span:first-child { font-weight: 700; flex-grow: 1; }
  .sheet-bg { position: fixed; inset: 0; background: rgba(22, 22, 26, 0.4); z-index: 20; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-width: 480px; margin: 0 auto; background: var(--ground); border-radius: 20px 20px 0 0; padding: 18px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
  .letters { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .letters button { height: 44px; border-radius: 8px; border: none; background: var(--tile-pending); font-weight: 800; font-size: 18px; }
</style>
