<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { releases } from '../lib/changelog';
  import WhatsNew from '../lib/WhatsNew.svelte';
  import { back, go } from '../lib/state.svelte';
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back" onclick={() => back('/settings')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px">What's new</h1>
  </header>
  <div style="padding: 4px 16px 32px; display: flex; flex-direction: column; gap: 24px">
    <WhatsNew list={releases} />
  </div>
</main>
