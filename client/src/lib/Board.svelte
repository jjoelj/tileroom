<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts" module>
  /** A tile placed this turn but not yet played; `slot` is its index in the rack. */
  export type PendingTile = { r: number; c: number; letter: string; blank: boolean; slot: number };
</script>

<script lang="ts">
  import { premiumAt, SIZE } from '../../../shared/board';
  import { VALUES } from '../../../shared/tiles';
  import type { BoardTile, FormedWord } from '../../../shared/types';
  import { pop, show } from './motion';

  let {
    board,
    pending,
    lastTurn,
    outlines,
    bubble,
    quiet,
    zoomed = $bindable(false),
    onCell,
    onPendingDown,
  }: {
    board: (BoardTile | null)[][];
    pending: PendingTile[];
    /** Turn number of the last play, to mark its tiles. */
    lastTurn: number | null;
    /** Words to outline in lime (only when the whole move is valid). */
    outlines: FormedWord[];
    bubble: { r: number; c: number; score: number; valid: boolean } | null;
    /** Tiles appear and leave instantly: a drag is already showing the movement. */
    quiet: boolean;
    zoomed?: boolean;
    onCell: (r: number, c: number) => void;
    /** Pointer down on a placed-this-turn tile: the parent may start dragging it. */
    onPendingDown: (e: PointerEvent, r: number, c: number) => void;
  } = $props();

  const LABEL = { '.': '', d: '2L', t: '3L', D: '2W', T: '3W', '*': '★' } as const;
  const NAME = { '.': '', d: 'double letter', t: 'triple letter', D: 'double word', T: 'triple word', '*': 'start' } as const;
  const COLS = 'ABCDEFGHIJKLMNO';

  // 225 cells, keyed by position: Svelte only touches cells whose content changed (SPEC §9.3).
  const cells = $derived.by(() => {
    const at = new Map(pending.map((p) => [p.r * SIZE + p.c, p]));
    return Array.from({ length: SIZE * SIZE }, (_, i) => {
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      const t = board[r]![c];
      const p = at.get(i);
      const prem = premiumAt(r, c);
      const tile = t ?? p ?? null;
      return {
        i,
        r,
        c,
        prem,
        pending: !!p,
        letter: tile?.letter ?? '',
        blank: tile?.blank ?? false,
        square: `p-${prem === '*' ? 'star' : prem}`,
        piece: p ? 'pending' : t && t.turn === lastTurn ? 'last' : '',
        label: `${COLS[c]}${r + 1}${tile ? `, ${tile.letter}${tile.blank ? ' (blank)' : ''}` : NAME[prem] ? `, ${NAME[prem]}` : ''}${p ? ', placed this turn' : ''}`,
      };
    });
  });

  // One outline around all valid words together, drawn as a single SVG mask: every word's box grown by 2px,
  // minus every word's box. Crossings merge cleanly and nothing is drawn over the tiles.
  let W = $state(0); // untransformed board width
  const pitch = $derived((W - (SIZE - 1)) / SIZE + 1); // cell + 1px gap
  const boxes = $derived(
    outlines.map((w) => ({
      x: w.c * pitch,
      y: w.r * pitch,
      w: (w.dir === 'across' ? w.length : 1) * pitch - 1,
      h: (w.dir === 'down' ? w.length : 1) * pitch - 1,
    })),
  );
  const RING = 2;

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
    return [x - r.left, y - r.top] as const;
  };

  // Programmatic zooms ease; pinch and pan follow the fingers directly.
  let easing = $state(false);
  let easeTimer = 0;
  function eased(fn: () => void) {
    easing = true;
    fn();
    clearTimeout(easeTimer);
    easeTimer = window.setTimeout(() => (easing = false), 260);
  }

  /** Zoom button / double tap: about 40px cells, or back to fit. */
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

  /** A cell's on-screen box, zoom included (for animating a tile exactly into it). */
  export function cellRect(r: number, c: number) {
    return (grid.children[r * SIZE + c] as HTMLElement).getBoundingClientRect();
  }

  /** The board cell under a screen point, if it's visible. */
  export function cellAt(x: number, y: number) {
    const v = viewport.getBoundingClientRect();
    if (x < v.left || x > v.right || y < v.top || y > v.bottom) return null;
    const g = grid.getBoundingClientRect();
    const r = Math.floor(((y - g.top) / g.height) * SIZE);
    const c = Math.floor(((x - g.left) / g.width) * SIZE);
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? { r, c } : null;
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
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.size >= 2 && pinch) {
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
    moved = true;
    if (s > 1.01) {
      tx += now.x - prev.x;
      ty += now.y - prev.y;
      clamp();
    }
  }

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
        <span class="lab" aria-hidden="true">{LABEL[cell.prem]}</span>
        {#if cell.letter}
          <span class="piece tile-face {cell.piece}" in:pop={{ quiet }} out:pop={{ quiet, duration: 140 }}>
            <span class="ch" class:blank={cell.blank}>{cell.letter}</span>
            {#if !cell.blank}<span class="pt">{VALUES[cell.letter]}</span>{/if}
          </span>
        {/if}
      </button>
    {/each}

    {#if boxes.length}
      {@const rx = (pitch - 1) * 0.16}
      <svg class="outline" width={W} height={W} aria-hidden="true" transition:show={{ duration: 140 }}>
        <mask id="word-ring" maskUnits="userSpaceOnUse" x={-RING} y={-RING} width={W + 2 * RING} height={W + 2 * RING}>
          {#each boxes as b, i (i)}<rect x={b.x - RING} y={b.y - RING} width={b.w + 2 * RING} height={b.h + 2 * RING} rx={rx + RING} fill="#fff" />{/each}
          {#each boxes as b, i (i)}<rect x={b.x} y={b.y} width={b.w} height={b.h} rx={rx} fill="#000" />{/each}
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
    --cs: min(calc((min(100vw, 480px) - 30px) / 15), 32px);
    width: calc(15 * var(--cs) + 14px);
    height: calc(15 * var(--cs) + 14px);
    margin: 0 auto;
    overflow: hidden;
    position: relative;
    touch-action: none; /* we handle pan and pinch */
    border-radius: 4px;
  }
  .board.easing { transition: transform 250ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .board { position: absolute; left: 0; top: 0; display: grid; grid-template-columns: repeat(15, var(--cs)); gap: 1px; transform-origin: 0 0; }
  .cell { position: relative; width: var(--cs); height: var(--cs); padding: 0; border: none; border-radius: 3px; background: var(--cell); display: flex; align-items: center; justify-content: center; color: var(--ink); }
  .lab { font-size: calc(var(--cs) * 0.31); font-weight: 800; letter-spacing: 0.02em; }
  .p-d { background: var(--dl-bg); color: var(--dl-fg); }
  .p-t { background: var(--tl-bg); color: var(--tl-fg); }
  .p-D { background: var(--dw-bg); color: var(--dw-fg); }
  .p-T { background: var(--tw-bg); color: var(--tw-fg); }
  .p-star .lab { font-size: calc(var(--cs) * 0.5); }
  /* A tile is its own layer over the square, so it can animate in and out. */
  .piece { position: absolute; inset: 0; border-radius: calc(var(--cs) * 0.16); z-index: 1; transition: box-shadow 300ms; }
  /* last move: a warm wash and a dot that fade in and out */
  .piece::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--tile-last); opacity: 0; transition: opacity 400ms; }
  .piece::after { content: ''; position: absolute; left: 3px; top: 3px; width: 4px; height: 4px; border-radius: 2px; background: var(--p4-bg); opacity: 0; transition: opacity 400ms; }
  .piece.last::before { opacity: 0.6; }
  .piece.last::after { opacity: 1; }
  /* placed this turn: a blue ring that fades away once the move is played */
  .piece.pending { box-shadow: inset 0 0 0 2px var(--link), 0 1px 2px rgba(0, 0, 0, 0.25); cursor: grab; }
  .ch { position: relative; font-size: calc(var(--cs) * 0.6); line-height: 1; transform: translateY(-4%); }
  .ch.blank { opacity: 0.5; }
  .pt { position: absolute; right: calc(var(--cs) * 0.08); bottom: calc(var(--cs) * 0.04); font-family: var(--ui); font-size: calc(var(--cs) * 0.26); font-weight: 700; opacity: 0.8; }
  .outline { position: absolute; left: 0; top: 0; overflow: visible; z-index: 2; pointer-events: none; fill: var(--valid); }
  .bubble { transition: background-color 200ms; position: absolute; translate: -60% -60%; will-change: scale; /* stays on its own layer: no subpixel snap when the pop ends */ min-width: 20px; height: 20px; padding: 0 4px; border-radius: 10px; background: var(--bubble-idle); color: #16161a; border: 2px solid #fff; font-weight: 800; font-size: 11px; display: flex; align-items: center; justify-content: center; z-index: 3; box-shadow: 0 2px 6px var(--shadow); pointer-events: none; }
  .bubble.valid { background: var(--valid); }
</style>
