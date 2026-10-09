<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { plural } from '../../../shared/plural';
  import { type Preview, previewPlay } from '../../../shared/rules';
  import { BAGS, VALUES } from '../../../shared/tiles';
  import type { GameView, PublicMove } from '../../../shared/types';
  import { api, ApiError } from '../lib/api';
  import Board, { type PendingTile } from '../lib/Board.svelte';
  import Count from '../lib/Count.svelte';
  import { grow, pop, rise, show } from '../lib/motion';
  import { invalidWords } from '../lib/dict';
  import { go, session, updates } from '../lib/state.svelte';

  let { id }: { id: string } = $props();

  let view = $state<GameView | null>(null);
  let missing = $state(false);
  let pending = $state<PendingTile[]>([]);
  let order = $state<number[]>([]); // display order of rack slots (Shuffle permutes it)
  let selected = $state<number | null>(null);
  let blankAt = $state<{ r: number; c: number; slot: number } | null>(null);
  let swapOpen = $state(false);
  let swapPick = $state<number[]>([]);
  let unseenOpen = $state(false);
  let menuOpen = $state(false);
  let zoomed = $state(false);
  let boardRef = $state<Board>();
  let rackEl = $state<HTMLDivElement>();
  let ghost = $state<HTMLDivElement>();
  let busy = $state(false);
  let message = $state('');

  const storeKey = $derived(`tileroom:pending:${id}`);
  const rack = $derived(view?.myRack ?? []);
  const myTurn = $derived(view?.status === 'active' && view.currentSeat === view.mySeat);
  const nameOf = (seat: number) => (seat === view?.mySeat ? 'You' : (view?.players[seat]?.displayName ?? ''));

  let deal = $state(0); // bumped when the server deals a new rack, so its tiles animate in

  /** Applies a fresh view, keeping placed tiles while they still fit the rack and board. */
  function apply(v: GameView) {
    const rackChanged = !view || (view.myRack ?? []).join() !== (v.myRack ?? []).join();
    view = v;
    if (rackChanged) {
      deal++;
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

  $effect(() => {
    if (updates.n) void load();
  });

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
  // Geometry, score and word lookups are computed together, two frames after a change (so placing a tile only
  // costs the swap), and replace the previous result in one step: the bubble and message never blank or flicker.
  type Result = { preview: Preview; invalid: string[] };
  let result = $state<Result | null>(null);
  $effect(() => {
    const tiles = $state.snapshot(onBoard) as PendingTile[];
    const v = view;
    if (!v || !tiles.length) {
      result = null;
      return;
    }
    let live = true;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(async () => {
        const p = previewPlay(v.board, tiles, () => true);
        const bad = p.ok ? await invalidWords(p.words.map((w) => w.word), v.expandedWords) : [];
        if (live) result = { preview: p, invalid: bad };
      });
    });
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  });
  const preview = $derived(result?.preview ?? null);
  const invalid = $derived(result?.invalid ?? null);
  const allValid = $derived(!!preview?.ok && invalid !== null && invalid.length === 0);
  // Lime outlines only when the whole move is valid; one bad word means none at all.
  const outlines = $derived(allValid && preview?.ok ? preview.words : []);
  const bubble = $derived(preview?.ok ? { ...preview.anchor, score: preview.score, valid: allValid } : null);
  const problem = $derived(
    invalid?.length
      ? `${invalid.join(', ')} ${invalid.length > 1 ? "aren't" : "isn't"} in this game's word list`
      : preview && !preview.ok
        ? preview.reason
        : '',
  );

  // ---- placing tiles: drag and drop (primary) or tap a tile, then a square (SPEC §9.2) ----
  type DragFrom = { kind: 'rack'; slot: number } | { kind: 'board'; r: number; c: number };
  let drag = $state<{ from: DragFrom; slot: number; letter: string; blank: boolean } | null>(null);
  // Tiles on the board right now: a placed tile picked up off the board doesn't count while it's held.
  const onBoard = $derived(drag?.from.kind === 'board' ? pending.filter((p) => p.slot !== drag!.slot) : pending);
  let justDragged = false; // the click that follows a drag isn't a tap

  const isFree = (r: number, c: number, except?: DragFrom) =>
    !!view &&
    !view.board[r]![c] &&
    !pending.some((p) => p.r === r && p.c === c && !(except?.kind === 'board' && except.r === r && except.c === c));

  function pointerDrag(e: PointerEvent, from: DragFrom) {
    if (e.button !== 0 || view?.status !== 'active') return;
    const tile =
      from.kind === 'rack'
        ? { slot: from.slot, letter: rack[from.slot]!, blank: rack[from.slot] === '?' }
        : pending.find((p) => p.r === from.r && p.c === from.c);
    if (!tile) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rackBox = rackEl?.getBoundingClientRect(); // read once; the rack doesn't move during a drag
    const x0 = e.clientX;
    const y0 = e.clientY;
    let x = x0;
    let y = y0;
    let frame = 0;
    // The ghost sits under the pointer, see-through, and moves with transform only (no layout reads).
    const paint = () => {
      frame = 0;
      if (ghost) ghost.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      // Over the rack, the tile's empty slot follows the pointer and the others slide aside (flip).
      if (rackBox && overRack(y, rackBox)) moveSlot(tile.slot, slotIndex(x, rackBox));
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!drag) {
        if (Math.hypot(x - x0, y - y0) < 4) return; // a plain tap stays a tap
        drag = { from, slot: tile.slot, letter: tile.letter, blank: tile.blank };
        selected = null;
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = async (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      cancelAnimationFrame(frame);
      if (!drag) return;
      justDragged = true;
      setTimeout(() => (justDragged = false));
      // Decide where the tile ends up, glide the ghost onto exactly that spot (same size and look),
      // then swap in the real tile and drop the ghost in the same update: nothing jumps.
      const plan = (ev.type === 'pointerup' && (await planDrop(from, tile.slot, ev.clientX, ev.clientY))) || (await planHome(from, tile.slot));
      await glide(plan.rect, plan.onBoard, plan.ms);
      if (!plan.onBoard) await slideDone(tile.slot); // the ghost waits on the final spot; then swap
      settling = true; // the ghost already showed this move: the swap itself is instant
      plan.commit?.();
      drag = null;
      landing = false;
      requestAnimationFrame(() => (settling = false));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  let landing = $state(false); // the ghost takes the placed-tile look while it lands on the board
  let settling = $state(false);
  const hush = $derived(!!drag || settling);
  const GHOST = { w: 44, h: 48 };

  /** Moves and resizes the ghost onto `rect` over `ms`, resolving when it has arrived. */
  function glide(rect: DOMRect | undefined, onBoard: boolean, ms = 120) {
    if (!ghost || !rect) return Promise.resolve();
    landing = onBoard;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    ghost.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${ms}ms`;
    ghost.style.opacity = '1';
    ghost.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%) scale(${rect.width / GHOST.w}, ${rect.height / GHOST.h})`;
    return new Promise<void>((resolve) => setTimeout(resolve, ms + 5));
  }

  const overRack = (y: number, r: DOMRect) => y >= r.top - 24 && y <= r.bottom + 24;
  const slotIndex = (x: number, r: DOMRect) => Math.max(0, Math.min(order.length - 1, Math.floor(((x - r.left) / r.width) * order.length)));
  function moveSlot(slot: number, to: number) {
    if (order.indexOf(slot) === to) return;
    const rest = order.filter((s) => s !== slot);
    rest.splice(to, 0, slot);
    order = rest;
  }
  /**
   * Where a rack slot will be once its slide (flip) finishes, and how long that takes. The ghost aims there
   * and lands no sooner, so it arrives together with the sliding tiles instead of cutting them short.
   */
  function slotTarget(slot: number): { rect: DOMRect | undefined; ms: number } {
    const el = rackEl?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    if (!el || !rackEl) return { rect: undefined, ms: 120 };
    const box = rackEl.getBoundingClientRect();
    // offsetLeft/Top are layout positions, unaffected by the running flip transform
    const rect = new DOMRect(box.left + rackEl.clientLeft + el.offsetLeft, box.top + rackEl.clientTop + el.offsetTop, el.offsetWidth, el.offsetHeight);
    let left = 0;
    for (const a of el.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      if (t) left = Math.max(left, Number(t.endTime ?? 0) - Number(t.localTime ?? 0));
    }
    return { rect, ms: Math.max(120, Math.ceil(left)) };
  }

  /** Resolves when a rack slot has stopped sliding (its flip may start a frame after the reorder). */
  async function slideDone(slot: number) {
    await new Promise(requestAnimationFrame);
    const el = rackEl?.querySelector(`[data-slot="${slot}"]`);
    await Promise.all((el?.getAnimations() ?? []).map((a) => a.finished.catch(() => {})));
  }

  type Plan = { rect: DOMRect | undefined; onBoard: boolean; ms?: number; commit?: () => void };

  /** Where a released tile goes, without changing anything yet. Null: nowhere valid. */
  async function planDrop(from: DragFrom, slot: number, x: number, y: number): Promise<Plan | null> {
    const cell = boardRef?.cellAt(x, y); // exactly where it's released
    if (cell && isFree(cell.r, cell.c, from)) {
      return {
        rect: boardRef?.cellRect(cell.r, cell.c),
        onBoard: true,
        commit: () => {
          if (from.kind === 'board') Object.assign(pending.find((p) => p.r === from.r && p.c === from.c)!, cell);
          else if (rack[slot] === '?') blankAt = { ...cell, slot };
          else pending.push({ ...cell, letter: rack[slot]!, blank: false, slot });
          if (from.kind === 'rack') requestAnimationFrame(() => boardRef?.zoomToward(cell.r, cell.c)); // after the swap
        },
      };
    }
    const r = rackEl?.getBoundingClientRect();
    if (r && overRack(y, r)) {
      // Into the gap it was hovering over; for a placed tile, that gap is its empty slot.
      moveSlot(slot, slotIndex(x, r));
      await tick();
      return {
        ...slotTarget(slot),
        onBoard: false,
        commit: () => {
          if (from.kind === 'board') pending = pending.filter((p) => !(p.r === from.r && p.c === from.c));
        },
      };
    }
    return null;
  }

  /** Back where it came from: its square, or its (possibly moved) slot in the rack. */
  async function planHome(from: DragFrom, slot: number): Promise<Plan> {
    if (from.kind === 'board') return { rect: boardRef?.cellRect(from.r, from.c), onBoard: true };
    await tick();
    return { ...slotTarget(slot), onBoard: false };
  }

  function tapSlot(slot: number) {
    if (justDragged || pending.some((p) => p.slot === slot)) return;
    selected = selected === slot ? null : slot;
  }

  function tapCell(r: number, c: number) {
    if (justDragged) return;
    const placed = pending.findIndex((p) => p.r === r && p.c === c);
    if (placed >= 0) {
      pending.splice(placed, 1);
      return;
    }
    if (selected === null || !view || view.status !== 'active' || view.board[r]![c]) return;
    const letter = rack[selected]!;
    if (letter === '?') blankAt = { r, c, slot: selected };
    else pending.push({ r, c, letter, blank: false, slot: selected });
    requestAnimationFrame(() => boardRef?.zoomToward(r, c));
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

  // Phones get the share sheet; anything with a mouse just copies.
  const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;
  function share() {
    if (!view?.joinCode) return;
    const text = `Join my Tileroom game: code ${view.joinCode} — ${location.origin}/join/${view.joinCode}`;
    if (canShare) navigator.share({ text }).catch(() => {});
    else
      navigator.clipboard?.writeText(text).then(
        () => (message = 'Copied. Paste it to the other players.'),
        () => (message = `Copy this: ${text}`),
      );
  }

  const describe = (m: PublicMove) =>
    m.type === 'play'
      ? `${nameOf(m.seat)} played ${m.words[0]?.word} for ${m.score}`
      : m.type === 'swap'
        ? `${nameOf(m.seat)} swapped ${plural(m.count, 'tile', 'tiles')}`
        : `${nameOf(m.seat)} passed`;

  // Everything not on the board or in my rack: the bag plus other players' racks, by letter.
  const unseen = $derived.by(() => {
    if (!view) return [] as [string, number][];
    const left: Record<string, number> = { ...BAGS[view.bagSize] };
    for (const row of view.board) for (const t of row) if (t) left[t.blank ? '?' : t.letter]!--;
    for (const l of rack) left[l]!--;
    return Object.entries(left)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => (a === '?' ? 1 : b === '?' ? -1 : a.localeCompare(b)));
  });
  const unseenTotal = $derived(unseen.reduce((sum, [, n]) => sum + n, 0));

  const statusText = $derived(
    !view
      ? ''
      : view.status === 'finished'
        ? 'Game over'
        : `${view.lastMove ? `${describe(view.lastMove)} · ` : ''}${myTurn ? 'Your turn' : `${nameOf(view.currentSeat)} is next`}`,
  );
  const line = $derived(message || problem || (view?.status === 'active' ? 'Drag tiles onto the board · drag back to the rack to undo' : ''));

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
        <div class="card popover" role="menu" transition:grow>
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
        <button class="secondary" onclick={share}>{canShare ? 'Share code' : 'Copy invite'}</button>
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
        {#if message}<p class="hint" role="status" transition:show>{message}</p>{/if}
      </section>
    {:else}
      <section class="strip" aria-label="Scores, in turn order">
        {#each view.players as p (p.seat)}
          <div class="pc" class:on={view.status === 'active' && p.seat === view.currentSeat}>
            <div class="pn" style="color: var(--p{p.colorIndex % 6})">
              <span class="dot"></span>{p.seat === view.mySeat ? 'You' : p.displayName}
              {#if view.winnerSeats?.includes(p.seat)}<svg in:pop role="img" aria-label="winner" width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>{/if}
            </div>
            <div class="sc"><Count value={p.score} /></div>
          </div>
        {/each}
      </section>

      <div class="status">
        {#key statusText}<span in:show={{ y: 4 }}>{statusText}</span>{/key}
        {#if view.status === 'active'}
          <button class="bagbtn" aria-haspopup="dialog" onclick={() => (unseenOpen = true)}>
            {view.finalRoundAfter !== null ? 'Last round · ' : ''}{view.bagCount} in bag
          </button>
        {/if}
      </div>

      <div style="position: relative">
        <Board
          bind:this={boardRef}
          bind:zoomed
          board={view.board}
          pending={onBoard}
          quiet={hush}
          lastTurn={view.lastMove?.type === 'play' ? view.lastMove.turn : null}
          {outlines}
          {bubble}
          onCell={tapCell}
          onPendingDown={(e, r, c) => pointerDrag(e, { kind: 'board', r, c })}
        />
        <button class="zoombtn" aria-label={zoomed ? 'Zoom out' : 'Zoom in'} aria-pressed={zoomed} onclick={() => boardRef?.toggleZoom()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M8 11h6" />{#if !zoomed}<path d="M11 8v6" />{/if}</svg>
        </button>
      </div>

      <p class="problem" role="status">
        {#key line}<span in:show={{ y: 4 }}>{line}</span>{/key}
      </p>

      {#if view.status === 'finished'}
        <section class="final" in:show={{ y: 8 }}>
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
        <div class="rack" aria-label="Your tiles" bind:this={rackEl}>
          {#each order as slot, i (`${deal}:${slot}`)}
            {@const used = pending.some((p) => p.slot === slot) || drag?.slot === slot}
            <div class="slot" data-slot={slot} animate:flip={{ duration: 180 }}>
            {#if used}
              <span class="rk empty" aria-hidden="true" in:show={{ duration: hush ? 0 : 160 }}></span>
            {:else}
              <button in:pop={{ quiet: hush, delay: i * 40 }} class="rk tile-face" class:sel={selected === slot} onpointerdown={(e) => pointerDrag(e, { kind: 'rack', slot })} aria-pressed={selected === slot} aria-label={rack[slot] === '?' ? 'Blank tile' : `Tile ${rack[slot]}, ${plural(VALUES[rack[slot]!]!, 'point', 'points')}`} onclick={() => tapSlot(slot)}>
                <span class="ch">{rack[slot] === '?' ? '' : rack[slot]}</span>
                {#if rack[slot] !== '?'}<span class="pt">{VALUES[rack[slot]!]}</span>{/if}
              </button>
            {/if}
            </div>
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
            {#if allValid}<span class="ready" transition:pop></span>{/if}
            Play{#if preview?.ok}&nbsp;·&nbsp;<Count value={preview.score} />{/if}
          </button>
        </div>
      {/if}
    {/if}
  </main>

  {#if drag}
    <div class="ghost tile-face" class:landing bind:this={ghost} aria-hidden="true">
      <span class="ch">{drag.blank && drag.from.kind === 'rack' ? '' : drag.letter}</span>
      {#if !drag.blank}<span class="pt">{VALUES[drag.letter]}</span>{/if}
    </div>
  {/if}

  {#if blankAt}
    <div class="sheet-bg" transition:show role="presentation" onclick={() => (blankAt = null)}></div>
    <div class="sheet" transition:rise role="dialog" aria-label="Choose a letter for the blank">
      <span class="label">Blank tile: pick a letter</span>
      <div class="letters">
        {#each 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' as l (l)}
          <button class="tile-face" onclick={() => pickBlank(l)}>{l}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if unseenOpen}
    <div class="sheet-bg" transition:show role="presentation" onclick={() => (unseenOpen = false)}></div>
    <div class="sheet" transition:rise role="dialog" aria-label="Unseen tiles">
      <span class="label">Tiles you can't see</span>
      <span class="hint">{plural(view.bagCount, 'tile', 'tiles')} in the bag · {plural(unseenTotal - view.bagCount, 'tile', 'tiles')} on other racks</span>
      <div class="unseen">
        {#each unseen as [letter, n] (letter)}
          <div class="u">
            <span class="tile-face mini" aria-label={letter === '?' ? 'Blank' : letter}>{letter === '?' ? '' : letter}</span>
            <span class="n">×{n}</span>
          </div>
        {/each}
      </div>
      <button class="secondary" onclick={() => (unseenOpen = false)}>Close</button>
    </div>
  {/if}

  {#if swapOpen}
    <div class="sheet-bg" transition:show role="presentation" onclick={() => (swapOpen = false)}></div>
    <div class="sheet" transition:rise role="dialog" aria-label="Swap tiles">
      <span class="label">Pick tiles to swap</span>
      <div class="rack" style="padding: 8px 0">
        {#each rack as letter, i (i)}
          <button
            class="rk tile-face"
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
  .popover { transform-origin: top right; position: absolute; right: 8px; top: 52px; z-index: 10; width: 220px; padding: 12px; box-shadow: 0 10px 30px var(--shadow); }
  .strip { display: flex; gap: 6px; padding: 0 8px 10px; overflow-x: auto; }
  .pc { flex: 0 0 auto; min-width: 68px; background: var(--surface); border-radius: 12px; padding: 7px 10px; display: flex; flex-direction: column; gap: 1px; }
  .pc.on { outline: 2px solid var(--p0); outline-offset: -2px; }
  .pn { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 4px; background: currentColor; }
  .sc { font-family: var(--display); font-weight: 800; font-size: 22px; line-height: 1.1; }
  .status { display: flex; justify-content: space-between; gap: 8px; padding: 0 12px 6px; font-size: 12px; color: var(--muted); font-weight: 600; }
  .zoombtn { position: absolute; right: 14px; bottom: 6px; width: 44px; height: 44px; border-radius: 22px; border: none; background: var(--float); color: #fff; backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 4; }
  .problem { margin: 10px 12px 0; min-height: 16px; font-size: 12px; font-weight: 600; color: var(--muted); text-align: center; }
  .rack { position: relative; display: flex; justify-content: center; gap: 6px; padding: 18px 8px 12px; }
  .rk { position: relative; width: 44px; height: 48px; border-radius: 8px; border: none; transition: transform 0.12s; touch-action: none; cursor: grab; }
  .ghost { position: fixed; left: 0; top: 0; width: 44px; height: 48px; border-radius: 8px; pointer-events: none; z-index: 30; will-change: transform; opacity: 0.7; box-shadow: 0 8px 20px var(--shadow), inset 0 -2px 0 var(--tile-edge); }
  .ghost .ch { font-size: 26px; line-height: 1; transform: translateY(-4%); }
  .ghost.landing { box-shadow: inset 0 0 0 4px var(--link), 0 2px 4px rgba(0, 0, 0, 0.25); }
  .rk.sel { outline: 3px solid var(--p0); outline-offset: 2px; transform: translateY(-6px); }
  .rk.empty { display: block; background: transparent; border: 1.5px dashed var(--dash); box-shadow: none; }
  .rk .ch { font-size: 26px; line-height: 1; transform: translateY(-4%); }
  .rk .pt, .ghost .pt { position: absolute; right: 5px; bottom: 3px; font-family: var(--ui); font-size: 10px; font-weight: 700; opacity: 0.8; }
  .actions { margin-top: auto; padding: 0 8px 20px; display: flex; gap: 8px; align-items: center; }
  .tool { width: 48px; height: 52px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--surface); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .tool.wide { width: auto; padding: 0 14px; }
  .tool:disabled { opacity: 0.4; }
  .playbtn { height: 52px; flex-grow: 1; border-radius: 14px; border: none; background: var(--primary); color: var(--on-primary); font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .playbtn:disabled { opacity: 0.35; }
  .ready { width: 8px; height: 8px; border-radius: 4px; background: var(--valid); }
  .lobby { padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 12px; }
  .code { font-family: var(--display); font-weight: 800; font-size: 44px; letter-spacing: 0.08em; text-align: center; padding: 8px 0; }
  .seats { overflow: hidden; }
  .seat { display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 52px; }
  .seat + .seat { border-top: 1px solid var(--line-soft); }
  .av { width: 34px; height: 34px; border-radius: 17px; color: var(--on-color); font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .av.open { border: 1.5px dashed var(--dash); }
  .final { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .final .row { display: flex; align-items: center; gap: 12px; background: var(--surface); border-radius: 12px; padding: 10px 14px; }
  .final .row span:first-child { font-weight: 700; flex-grow: 1; }
  .sheet-bg { position: fixed; inset: 0; background: var(--scrim); z-index: 20; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-width: 480px; margin: 0 auto; background: var(--ground); border-radius: 20px 20px 0 0; padding: 18px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
  .slot { display: block; }
  .bagbtn { border: none; background: none; padding: 0; min-height: 24px; font-size: 12px; font-weight: 700; color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
  .unseen { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 8px; max-height: 50dvh; overflow: auto; padding: 4px 0; }
  .u { display: flex; align-items: center; gap: 4px; }
  .mini { width: 28px; height: 30px; border-radius: 5px; font-size: 16px; flex-shrink: 0; }
  .n { font-size: 13px; font-weight: 700; color: var(--muted); }
  .letters { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .letters button { height: 44px; border-radius: 8px; border: none; font-size: 20px; }
</style>
