<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- The release list, shared by the after-update popup and Settings > What's new. -->
<script lang="ts">
  import type { Release } from './changelog';

  let { list }: { list: Release[] } = $props();
</script>

{#each list as r (r.title)}
  <section class="release">
    <h2 class="label">{r.version === 'Unreleased' ? 'Coming next' : r.title}</h2>
    {#if r.note}<p class="note">{r.note}</p>{/if}
    <ul>
      {#each r.items as item, i (i)}<li>{item}</li>{/each}
    </ul>
  </section>
{/each}

<style>
  .release { display: flex; flex-direction: column; gap: 8px; }
  .label { margin: 0; }
  .note { margin: 0; font-weight: 700; }
  ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; line-height: 1.45; color: var(--body); }
</style>
