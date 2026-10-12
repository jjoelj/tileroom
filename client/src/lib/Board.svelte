<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts" module>
  /** A tile placed this turn but not yet played; `slot` is its index in the rack. */
  export type PendingTile = { r: number; c: number; letter: string; blank: boolean; slot: number };
</script>

<script lang="ts">
  import { type Layout, premiumAt, SIZE } from '../../../shared/board';
  import { VALUES } from '../../../shared/tiles';
  import type { BoardTile, FormedWord } from '../../../shared/types';
  import { devicePixel, drop, ms, pop, show } from './motion';

  let {
    board,
    layout,
    pending,
    lastTurn,
    outlines,
    bubble,
    quiet,
    dropping = [],
    ghosts = [],
    zoomed = $bindable(false),
    onCell,
    onPendingDown,
  }: {
    board: (BoardTile | null)[][];
    layout: Layout;
    pending: PendingTile[];
    /** Tiles played on this turn or later are marked (the last play, or every play since mine). */
    lastTurn: number | null;
    /** Words to outline in lime (only when the whole move is valid). */
    outlines: FormedWord[];
    bubble: { r: number; c: number; score: number; valid: boolean } | null;
    /** Tiles appear and leave instantly: a drag is already showing the movement. */
    quiet: boolean;
    /** Another player's play arriving now: its tiles drop in one by one. */
    dropping?: { r: number; c: number }[];
    /** Squares another player has tiles on during their turn: letterless, faint. */
    ghosts?: [number, number][];
    zoomed?: boolean;
    onCell: (r: number, c: number) => void;
    /** Pointer down on a placed-this-turn tile: the parent may start dragging it. */
    onPendingDown: (e: PointerEvent, r: number, c: number) => void;
  } = $props();

  const LABEL = { '.': '', d: '2L', t: '3L', D: '2W', T: '3W', '*': '', '+': '' } as const; // the start square draws a star
  const NAME = { '.': '', d: 'double letter', t: 'triple letter', D: 'double word', T: 'triple word', '*': 'start', '+': 'start, double word' } as const;
  const COLS = 'ABCDEFGHIJKLMNO';

  /** Tiles in the order they're set down: reading order. */
  const readingOrder = (tiles: { r: number; c: number }[]) => [...tiles].sort((a, b) => a.r - b.r || a.c - b.c);
  const dropAt = $derived(new Map(readingOrder(dropping).map((t, k) => [t.r * SIZE + t.c, k])));
  const ghostAt = $derived(new Set(ghosts.map(([r, c]) => r * SIZE + c)));

  // 225 cells, keyed by position: Svelte only touches cells whose content changed (SPEC §9.3).
  const cells = $derived.by(() => {
    const at = new Map(pending.map((p) => [p.r * SIZE + p.c, p]));
    return Array.from({ length: SIZE * SIZE }, (_, i) => {
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      const t = board[r]![c];
      const p = at.get(i);
      const prem = premiumAt(layout, r, c);
      const tile = t ?? p ?? null;
      return {
        i,
        r,
        c,
        prem,
        drop: dropAt.get(i),
        ghost: !t && !p && ghostAt.has(i),
        pending: !!p,
        letter: tile?.letter ?? '',
        blank: tile?.blank ?? false,
        square: prem === '*' ? 'p-star' : prem === '+' ? 'p-D p-star' : `p-${prem}`,
        piece: p ? 'pending' : t && lastTurn !== null && t.turn >= lastTurn ? 'last' : '',
        label: `${COLS[c]}${r + 1}${tile ? `, ${tile.letter}${tile.blank ? ' (blank)' : ''}` : NAME[prem] ? `, ${NAME[prem]}` : ''}${p ? ', placed this turn' : ''}`,
      };
    });
  });

  // One outline around all valid words together, drawn as a single SVG mask: the covered cells grown by 2px,
  // minus the covered cells with every gap between covered neighbours filled in. Built per cell, not per word,
  // so blocks (a 2×2 square, a row laid along another) merge too. Only outside corners are rounded.
  let W = $state(0); // untransformed board width
  const RING = 2;
  /** A rectangle path with its own radius per corner (tl, tr, br, bl); all clockwise, so subpaths union. */
  const rect = (x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) =>
    `M${x + tl!},${y}H${x + w - tr!}A${tr},${tr} 0 0 1 ${x + w},${y + tr!}V${y + h - br!}A${br},${br} 0 0 1 ${x + w - br!},${y + h}` +
    `H${x + bl!}A${bl},${bl} 0 0 1 ${x},${y + h - bl!}V${y + tl!}A${tl},${tl} 0 0 1 ${x + tl!},${y}Z`;
  const ring = $derived.by(() => {
    const on = new Set<number>();
    for (const w of outlines) for (let k = 0; k < w.length; k++) on.add(w.dir === 'across' ? w.r * SIZE + w.c + k : (w.r + k) * SIZE + w.c);
    if (!on.size) return null;
    const has = (r: number, c: number) => r >= 0 && c >= 0 && r < SIZE && c < SIZE && on.has(r * SIZE + c);
    const cs = (W - (SIZE - 1)) / SIZE;
    const rx = cs * 0.16; // the tiles' own corner radius
    let outer = '';
    let inner = '';
    for (const i of on) {
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      const [x, y] = [c * (cs + 1), r * (cs + 1)];
      const [t, rt, b, l] = [!has(r - 1, c), !has(r, c + 1), !has(r + 1, c), !has(r, c - 1)];
      const round = (k: number) => [t && l, t && rt, b && rt, b && l].map((convex) => (convex ? k : 0));
      outer += rect(x - RING, y - RING, cs + 2 * RING, cs + 2 * RING, round(rx + RING));
      inner += rect(x, y, cs, cs, round(rx));
      const none = [0, 0, 0, 0];
      if (!rt) inner += rect(x + cs, y, 1, cs, none); // the gap to the right neighbour
      if (!b) inner += rect(x, y + cs, cs, 1, none); // the gap below
      if (!rt && !b && has(r + 1, c + 1)) inner += rect(x + cs, y + cs, 1, 1, none); // where four gaps meet
    }
    return { outer, inner };
  });

  // A tile appearing: dropped in when another player played it, else the usual pop.
  const enter = (node: Element, { quiet, drop: k }: { quiet: boolean; drop: number | undefined }) =>
    k === undefined ? pop(node, { quiet }) : drop(node, { delay: dropDelay(k) });

  const pos = (r: number, c: number) => `left: calc(${c} * (var(--cs) + 1px)); top: calc(${r} * (var(--cs) + 1px));`;
  // On the anchor tile's bottom-right corner, but kept inside the board on the last row/column.
  const bubblePos = (r: number, c: number) =>
    `left: min(calc(${c + 1} * (var(--cs) + 1px)), calc(100% - 16px)); top: min(calc(${r + 1} * (var(--cs) + 1px)), calc(100% - 12px));`;

  // ---- zoom and pan: a CSS transform on the grid; the viewport clips it (SPEC §9.2) ----
  let viewport: HTMLDivElement;
  let grid: HTMLDivElement;
  let s = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  const MAX = 2.6;
  /** Margin inside the viewport around the board (CSS --pad): edge outlines show, edge squares are easier to hit. */
  const PAD = 6;

  const size = () => grid.offsetWidth; // untransformed board width (== height)
  function clamp() {
    const w = size();
    tx = Math.min(0, Math.max(w - w * s, tx));
    ty = Math.min(0, Math.max(w - w * s, ty));
    zoomed = s > 1.01;
  }
  /** Scale to `next` keeping the viewport point (px, py) fixed under the finger. */
  function zoomAt(next: number, px: number, py: number) {
    const n = Math.min(MAX, Math.max(1, next));
    tx = px - ((px - tx) * n) / s;
    ty = py - ((py - ty) * n) / s;
    s = n;
    clamp();
  }
  const local = (x: number, y: number) => {
    const r = viewport.getBoundingClientRect();
    return [x - r.left - PAD, y - r.top - PAD] as const; // board coordinates (the board sits PAD in)
  };

  // Programmatic zooms ease; pinch and pan follow the fingers directly.
  let easing = $state(false);
  let easeTimer = 0;
  function eased(fn: () => void) {
    easing = true;
    fn();
    // the board ends on whole device pixels on screen, so it doesn't shift when the eased (composited) move hands back
    const v = viewport.getBoundingClientRect();
    tx = devicePixel(v.left + PAD + tx) - v.left - PAD;
    ty = devicePixel(v.top + PAD + ty) - v.top - PAD;
    clearTimeout(easeTimer);
    easeTimer = window.setTimeout(() => (easing = false), 260);
  }

  /** Double tap (or double click): about 40px cells, or back to fit. */
  export function toggleZoom(x?: number, y?: number) {
    const w = size();
    const [px, py] = x === undefined || y === undefined ? [w / 2, w / 2] : local(x, y);
    eased(() => zoomAt(s > 1.01 ? 1 : Math.max(1.6, (40 * SIZE) / w), px, py));
  }

  /** After placing a tile on the fully zoomed-out board, zoom in a little around it. */
  export function zoomToward(r: number, c: number) {
    if (s > 1.01) return;
    const step = size() / SIZE;
    eased(() => zoomAt(1.4, (c + 0.5) * step, (r + 0.5) * step));
  }

  /** Between tiles set down one by one; the first waits for the board to move to them. */
  const dropDelay = (k: number) => 260 + k * 90;

  /**
   * A move was just played: bring its tiles into view (zooming out only as far as they need; from fully zoomed out,
   * in a little, like placing a tile). Another player's tiles drop in on their own (`dropping`); mine are already
   * there, so they settle one by one with a small stamp.
   */
  export function placed(tiles: { r: number; c: number }[], mine: boolean) {
    if (!tiles.length) return;
    if (!pointers.size) reveal(tiles); // never move the board out from under a finger
    if (!mine) return;
    readingOrder(tiles).forEach(({ r, c }, k) =>
        grid.children[r * SIZE + c]
          ?.querySelector('.piece')
          ?.animate([{ scale: 1 }, { scale: 1.18, offset: 0.4 }, { scale: 1 }], { duration: ms(240), delay: ms(dropDelay(k)), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }),
      );
  }

  function reveal(tiles: { r: number; c: number }[]) {
    const w = size();
    const step = w / SIZE;
    const [rs, cs] = [tiles.map((t) => t.r), tiles.map((t) => t.c)];
    const [x0, x1] = [Math.min(...cs) * step, (Math.max(...cs) + 1) * step];
    const [y0, y1] = [Math.min(...rs) * step, (Math.max(...rs) + 1) * step];
    const fit = (w - 2 * step) / Math.max(x1 - x0, y1 - y0); // the scale that shows them with a cell to spare around
    const n = Math.max(1, Math.min(s > 1.01 ? s : 1.4, fit));
    const inView = (a: number, b: number, t: number) => a * s + t >= 0 && b * s + t <= w;
    if (n === s && inView(x0, x1, tx) && inView(y0, y1, ty)) return;
    eased(() => {
      s = n;
      tx = w / 2 - ((x0 + x1) / 2) * n;
      ty = w / 2 - ((y0 + y1) / 2) * n;
      clamp();
    });
  }

  /** Slides the tile now at (r, c) over from the square it just left (the other half of a swap). */
  export function slideFrom(r: number, c: number, from: { r: number; c: number }) {
    const [a, b] = [cellRect(from.r, from.c), cellRect(r, c)];
    const [x, y] = [(a.left - b.left) / s, (a.top - b.top) / s]; // the grid is scaled: back to board pixels
    // `inset`, not `translate`: a composited layer at fractional zoom snaps to whole pixels when it ends
    grid.children[r * SIZE + c]
      ?.querySelector('.piece')
      ?.animate([{ inset: `${y}px ${-x}px ${-y}px ${x}px`, zIndex: 2 }, { inset: '0px', zIndex: 2 }], { duration: ms(200), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }

  /** A cell's on-screen box, zoom included (for animating a tile exactly into it). */
  export function cellRect(r: number, c: number) {
    return (grid.children[r * SIZE + c] as HTMLElement).getBoundingClientRect();
  }

  /** The board cell under a screen point, if it's visible. In the margin, the nearest edge square counts. */
  export function cellAt(x: number, y: number) {
    const v = viewport.getBoundingClientRect();
    if (x < v.left || x > v.right || y < v.top || y > v.bottom) return null;
    const g = grid.getBoundingClientRect();
    const near = (k: number) => Math.min(SIZE - 1, Math.max(0, k));
    const r = Math.floor(((y - g.top) / g.height) * SIZE);
    const c = Math.floor(((x - g.left) / g.width) * SIZE);
    const slack = PAD + 2; // only just past the edge: a drop in the margin, not somewhere off the board
    if (y < g.top - slack || y > g.bottom + slack || x < g.left - slack || x > g.right + slack) return null;
    return { r: near(r), c: near(c) };
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 };
  let pinch: { d: number; s: number } | null = null;
  let moved = false;
  let lastTap = { t: 0, x: 0, y: 0 };

  function down(e: PointerEvent) {
    const cell = (e.target as Element).closest<HTMLElement>('[data-pending]');
    if (cell) return onPendingDown(e, Number(cell.dataset.r), Number(cell.dataset.c));
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      start = { x: e.clientX, y: e.clientY };
      moved = false;
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), s };
      moved = true;
    }
  }

  function move(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return up(e); // released where we couldn't hear it
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.size >= 2 && pinch) {
      capture(e);
      const [a, b] = [...pointers.values()];
      const midBefore = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      pointers.set(e.pointerId, now);
      const [a2, b2] = [...pointers.values()];
      const mid = { x: (a2!.x + b2!.x) / 2, y: (a2!.y + b2!.y) / 2 };
      tx += mid.x - midBefore.x;
      ty += mid.y - midBefore.y;
      const [px, py] = local(mid.x, mid.y);
      zoomAt((pinch.s * Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y)) / pinch.d, px, py);
      return;
    }
    pointers.set(e.pointerId, now);
    if (!moved && Math.hypot(now.x - start.x, now.y - start.y) < 6) return;
    if (!moved) capture(e);
    moved = true;
    if (s > 1.01) {
      tx += now.x - prev.x;
      ty += now.y - prev.y;
      clamp();
    }
  }

  // Once a pan or pinch starts, keep the pointer even outside the board, so releasing anywhere ends it.
  // (Not on pointerdown: capture would retarget the click that a plain tap on a cell needs.)
  const capture = (e: PointerEvent) => viewport.hasPointerCapture(e.pointerId) || viewport.setPointerCapture(e.pointerId);

  function up(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (moved || pointers.size) return;
    // double tap toggles zoom (a single tap stays a tap: the cell's click still fires)
    const t = performance.now();
    if (t - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      toggleZoom(e.clientX, e.clientY);
      lastTap = { t: 0, x: 0, y: 0 };
    } else lastTap = { t, x: e.clientX, y: e.clientY };
  }

  // After a pan or pinch the finger lifts over some cell; don't treat that as a tap on it.
  function swallowClick(e: MouseEvent) {
    if (moved) {
      e.stopPropagation();
      e.preventDefault();
      moved = false;
    }
  }

  // Trackpad pinch and Ctrl+wheel zoom; plain wheel pans while zoomed. Needs a non-passive listener.
  $effect(() => {
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const [px, py] = local(e.clientX, e.clientY);
        zoomAt(s * Math.exp(-e.deltaY * (e.deltaMode ? 0.15 : 0.006)), px, py); // ~1.8x per wheel notch; trackpad pinch tracks
      } else if (s > 1.01) {
        e.preventDefault();
        tx -= e.deltaX;
        ty -= e.deltaY;
        clamp();
      }
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  });
</script>

<div
  class="viewport"
  bind:this={viewport}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onlostpointercapture={(e) => e.target === viewport && up(e)}
  onclickcapture={swallowClick}
  role="presentation"
>
  <div class="board" class:easing bind:this={grid} bind:clientWidth={W} role="grid" aria-label="Game board" style="transform: translate({tx}px, {ty}px) scale({s})">
    {#each cells as cell (cell.i)}
      <button
        class="cell {cell.square}"
        aria-label={cell.label}
        data-pending={cell.pending ? '' : undefined}
        data-r={cell.r}
        data-c={cell.c}
        onclick={() => onCell(cell.r, cell.c)}
      >
        {#if cell.prem === '*' || cell.prem === '+'}
          <!-- drawn, not the ★ character: a glyph sits on the font's baseline, never quite in the middle -->
          <svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>
        {:else}
          <span class="lab" aria-hidden="true">{LABEL[cell.prem]}</span>
        {/if}
        {#if cell.letter || cell.pending}<!-- pending with no letter: a blank still being chosen -->
          <span class="piece tile-face {cell.piece}" in:enter={{ quiet, drop: cell.drop }} out:pop={{ quiet, duration: 140 }}>
            <span class="ch" class:blank={cell.blank}>{cell.letter}</span>
            {#if !cell.blank}<span class="pt">{VALUES[cell.letter]}</span>{/if}
          </span>
        {:else if cell.ghost}
          <span class="piece tile-face ghost" aria-hidden="true" transition:pop={{ duration: 140 }}></span>
        {/if}
      </button>
    {/each}

    {#if ring}
      <svg class="outline" width={W} height={W} aria-hidden="true" transition:show={{ duration: 140 }}>
        <mask id="word-ring" maskUnits="userSpaceOnUse" x={-RING} y={-RING} width={W + 2 * RING} height={W + 2 * RING}>
          <path d={ring.outer} fill="#fff" />
          <path d={ring.inner} fill="#000" />
        </mask>
        <rect x={-RING} y={-RING} width={W + 2 * RING} height={W + 2 * RING} mask="url(#word-ring)" />
      </svg>
    {/if}

    {#if bubble}
      <!-- keyed by spot: when the anchor tile changes, the bubble pops in at the new spot instead of sliding -->
      {#key `${bubble.r},${bubble.c}`}
        <div class="bubble" class:valid={bubble.valid} aria-label="Score if played: {bubble.score}" style={bubblePos(bubble.r, bubble.c)} in:pop>
          {bubble.score}
        </div>
      {/key}
    {/if}
  </div>
</div>

<style>
  .viewport {
    --pad: 6px; /* PAD in the script */
    --cs: min(calc((min(100vw, 480px) - 30px - 2 * var(--pad)) / 15), 32px);
    width: calc(15 * var(--cs) + 14px + 2 * var(--pad));
    height: calc(15 * var(--cs) + 14px + 2 * var(--pad));
    margin: 0 auto;
    overflow: hidden;
    position: relative;
    touch-action: none; /* we handle pan and pinch */
    border-radius: 4px;
  }
  .board.easing { transition: transform 250ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .board { position: absolute; left: var(--pad); top: var(--pad); display: grid; grid-template-columns: repeat(15, var(--cs)); gap: 1px; transform-origin: 0 0; }
  .cell { position: relative; width: var(--cs); height: var(--cs); padding: 0; border: none; border-radius: 3px; background: var(--cell); display: flex; align-items: center; justify-content: center; color: var(--ink); }
  .lab { font-size: calc(var(--cs) * 0.31); font-weight: 800; letter-spacing: 0.02em; }
  .p-d { background: var(--dl-bg); color: var(--dl-fg); }
  .p-t { background: var(--tl-bg); color: var(--tl-fg); }
  .p-D { background: var(--dw-bg); color: var(--dw-fg); }
  .p-T { background: var(--tw-bg); color: var(--tw-fg); }
  .star { width: calc(var(--cs) * 0.5); height: calc(var(--cs) * 0.5); fill: currentColor; }
  /* A tile is its own layer over the square, so it can animate in and out. */
  .piece { position: absolute; inset: 0; border-radius: calc(var(--cs) * 0.16); z-index: 1; transition: filter 300ms; }
  /* last move: a warm wash and a dot that fade in and out */
  .piece::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--tile-last); opacity: 0; transition: opacity 400ms; }
  .piece::after { content: ''; position: absolute; left: 3px; top: 3px; width: 4px; height: 4px; border-radius: 2px; background: var(--p4-bg); opacity: 0; transition: opacity 400ms; }
  .piece.last::before { opacity: 0.6; }
  .piece.last::after { opacity: 1; }
  /* placed this turn: the normal tile (same bevel, same size), much paler; fades back once played */
  .piece.pending { filter: brightness(1.12) saturate(0.35); cursor: grab; }
  /* another player's tile, mid-turn: where, not what */
  /* faintness in filter, not opacity: the pop animates opacity and would end fully solid, then jump */
  .piece.ghost { filter: saturate(0.35) opacity(0.45); pointer-events: none; }
  .ch { position: relative; font-size: calc(var(--cs) * 0.6); line-height: 1; transform: translateY(-4%); }
  .ch.blank { opacity: 0.5; }
  .pt { position: absolute; right: calc(var(--cs) * 0.08); bottom: calc(var(--cs) * 0.04); font-family: var(--ui); font-size: calc(var(--cs) * 0.26); font-weight: 700; opacity: 0.8; }
  .outline { position: absolute; left: 0; top: 0; overflow: visible; z-index: 2; pointer-events: none; fill: var(--valid); }
  .bubble { transition: background-color 200ms; position: absolute; translate: -60% -60%; will-change: scale; /* stays on its own layer: no subpixel snap when the pop ends */ min-width: 20px; height: 20px; padding: 0 4px; border-radius: 10px; background: var(--bubble-idle); color: var(--bubble-fg); border: 2px solid var(--surface); font-weight: 800; font-size: 11px; display: flex; align-items: center; justify-content: center; z-index: 3; box-shadow: 0 2px 6px var(--shadow); pointer-events: none; }
  .bubble.valid { background: var(--valid); color: var(--on-valid); }
</style>
