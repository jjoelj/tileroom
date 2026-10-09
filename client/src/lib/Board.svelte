<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts" module>
  /** A tile placed this turn but not yet played; `slot` is its index in the rack. */
  export type PendingTile = { r: number; c: number; letter: string; blank: boolean; slot: number };
</script>

<script lang="ts">
  import { premiumAt, SIZE } from '../../../shared/board';
  import { VALUES } from '../../../shared/tiles';
  import type { BoardTile, FormedWord } from '../../../shared/types';

  let {
    board,
    pending,
    lastTurn,
    outlines,
    bubble,
    zoom,
    onCell,
  }: {
    board: (BoardTile | null)[][];
    pending: PendingTile[];
    /** Turn number of the last play, to mark its tiles. */
    lastTurn: number | null;
    /** Words to outline in lime (valid ones only). */
    outlines: FormedWord[];
    bubble: { r: number; c: number; score: number; valid: boolean } | null;
    zoom: boolean;
    onCell: (r: number, c: number) => void;
  } = $props();

  const LABEL = { '.': '', d: 'DL', t: 'TL', D: 'DW', T: 'TW', '*': '★' } as const;
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
        letter: tile?.letter ?? '',
        blank: tile?.blank ?? false,
        state: p ? 'pending' : t ? (t.turn === lastTurn ? 'tile last' : 'tile') : `empty p-${prem === '*' ? 'star' : prem}`,
        label: `${COLS[c]}${r + 1}${tile ? `, ${tile.letter}${tile.blank ? ' (blank)' : ''}` : NAME[prem] ? `, ${NAME[prem]}` : ''}${p ? ', placed this turn' : ''}`,
      };
    });
  });

  const pos = (r: number, c: number) => `left: calc(${c} * (var(--cs) + 1px)); top: calc(${r} * (var(--cs) + 1px));`;
</script>

<div class="wrap" class:zoom>
  <div class="board" role="grid" aria-label="Game board">
    {#each cells as cell (cell.i)}
      <button class="cell {cell.state}" aria-label={cell.label} onclick={() => onCell(cell.r, cell.c)}>
        {#if cell.letter}
          <span class="ch" class:blank={cell.blank}>{cell.letter}</span>
          {#if !cell.blank}<span class="pt">{VALUES[cell.letter]}</span>{/if}
        {:else}
          <span class="lab">{LABEL[cell.prem]}</span>
        {/if}
      </button>
    {/each}

    {#each outlines as w (`${w.dir}${w.r},${w.c}`)}
      <div
        class="outline"
        aria-hidden="true"
        style="{pos(w.r, w.c)} width: calc({w.dir === 'across' ? w.length : 1} * (var(--cs) + 1px) - 1px); height: calc({w.dir === 'down' ? w.length : 1} * (var(--cs) + 1px) - 1px);"
      ></div>
    {/each}

    {#if bubble}
      <div class="bubble" class:valid={bubble.valid} aria-label="Score if played: {bubble.score}" style={pos(bubble.r + 1, bubble.c + 1)}>
        {bubble.score}
      </div>
    {/if}
  </div>
</div>

<style>
  .wrap { --cs: min(calc((min(100vw, 480px) - 30px) / 15), 32px); overflow: auto; padding: 0 8px; }
  .wrap.zoom { --cs: 40px; max-height: 70dvh; }
  .board { position: relative; display: grid; grid-template-columns: repeat(15, var(--cs)); gap: 1px; width: max-content; margin: 0 auto; }
  .cell { position: relative; width: var(--cs); height: var(--cs); padding: 0; border: none; border-radius: 3px; background: var(--cell); display: flex; align-items: center; justify-content: center; color: var(--ink); }
  .lab { font-size: calc(var(--cs) * 0.31); font-weight: 800; letter-spacing: 0.02em; }
  .p-d { background: var(--dl-bg); color: var(--dl-fg); }
  .p-t { background: var(--tl-bg); color: var(--tl-fg); }
  .p-D { background: var(--dw-bg); color: var(--dw-fg); }
  .p-T { background: var(--tw-bg); color: var(--tw-fg); }
  .p-star .lab { font-size: calc(var(--cs) * 0.5); }
  .tile { background: var(--tile); color: var(--tile-fg); box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14); }
  .last { background: var(--tile-last); }
  .pending { background: var(--tile-pending); color: var(--tile-fg); outline: 2px solid var(--ink); outline-offset: -2px; z-index: 1; }
  .ch { font-size: calc(var(--cs) * 0.58); font-weight: 800; line-height: 1; }
  .ch.blank { opacity: 0.55; }
  .pt { position: absolute; right: 2px; bottom: 1px; font-size: calc(var(--cs) * 0.27); font-weight: 700; }
  .outline { position: absolute; box-sizing: border-box; border: 3px solid var(--valid); border-radius: 6px; z-index: 2; pointer-events: none; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7); }
  .bubble { position: absolute; transform: translate(-60%, -60%); min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; background: #b9b5a8; color: var(--ink); border: 2px solid #fff; font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: center; z-index: 3; box-shadow: 0 2px 6px rgba(22, 22, 26, 0.25); pointer-events: none; }
  .bubble.valid { background: var(--valid); }
</style>
