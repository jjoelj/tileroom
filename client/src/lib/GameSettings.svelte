<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- A game's settings, on New game and in the lobby: the host changes them until the start; others just see them. -->
<script lang="ts" module>
  import type { Layout } from '../../../shared/board';

  export type Settings = { bagSize: 100 | 150; randomOrder: boolean; expandedWords: boolean; livePlacing: boolean; layout: Layout };
</script>

<script lang="ts">
  let { value, disabled = false, onchange }: { value: Settings; disabled?: boolean; onchange: (change: Partial<Settings>) => void } = $props();
</script>

<div class="card">
  <div class="line">
    <div class="stack" style="gap: 1px">
      <span class="strong">Board</span>
      <span class="hint">{value.layout === 'classic' ? 'Word bonuses near the middle' : 'Bonuses out toward the edges'}</span>
    </div>
    <div class="segment" role="radiogroup" aria-label="Board">
      {#each [['default', 'Default'], ['classic', 'Classic']] as const as [layout, name] (layout)}
        <button role="radio" aria-checked={value.layout === layout} class:on={value.layout === layout} {disabled} onclick={() => onchange({ layout })}>{name}</button>
      {/each}
    </div>
  </div>
  <div class="line">
    <div class="stack" style="gap: 1px">
      <span class="strong">Tile bag</span>
      <span class="hint">{value.bagSize === 150 ? 'Big bag, good for 5 or 6 players' : 'Standard bag'}</span>
    </div>
    <div class="segment" role="radiogroup" aria-label="Tile bag">
      {#each [100, 150] as const as bagSize (bagSize)}
        <button role="radio" aria-checked={value.bagSize === bagSize} class:on={value.bagSize === bagSize} {disabled} onclick={() => onchange({ bagSize })}>{bagSize}</button>
      {/each}
    </div>
  </div>
  <label class="line toggle">
    <span class="stack" style="gap: 1px">
      <span>Random turn order</span>
      <span class="hint">{value.randomOrder ? 'Shuffled at start' : 'Order joined, host first'}</span>
    </span>
    <input type="checkbox" checked={value.randomOrder} {disabled} onchange={(e) => onchange({ randomOrder: e.currentTarget.checked })} />
  </label>
  <label class="line toggle">
    <span class="stack" style="gap: 1px">
      <span>Show tiles being placed</span>
      <span class="hint">{value.livePlacing ? 'Others see where, not which letters' : 'Only finished moves show'}</span>
    </span>
    <input type="checkbox" checked={value.livePlacing} {disabled} onchange={(e) => onchange({ livePlacing: e.currentTarget.checked })} />
  </label>
  <label class="line toggle">
    <span class="stack" style="gap: 1px">
      <span>Use expanded word list</span>
      <span class="hint">{value.expandedWords ? 'Abbreviations like FAQ allowed' : 'Standard words only'}</span>
    </span>
    <input type="checkbox" checked={value.expandedWords} {disabled} onchange={(e) => onchange({ expandedWords: e.currentTarget.checked })} />
  </label>
</div>

<style>
  .card { overflow: hidden; }
  .line { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 8px 0 14px; min-height: 60px; }
  .line + .line { border-top: 1px solid var(--line-soft); }
  .strong { font-weight: 800; font-size: 16px; }
  .segment { display: flex; background: var(--well); border-radius: 12px; padding: 3px; }
  .segment button { height: 38px; min-width: 52px; padding: 0 12px; border-radius: 9px; border: none; background: transparent; font-weight: 700; font-size: 14px; }
  .segment button.on { background: var(--surface); }
  .segment button:disabled:not(.on) { opacity: 0.5; }
  .toggle { padding-right: 14px; font-weight: 800; font-size: 15px; }
  .toggle input { width: 22px; height: 22px; accent-color: var(--ink); flex-shrink: 0; }
</style>
