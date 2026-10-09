<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Floating status messages (see say.svelte.ts). The live region is always there, so screen readers hear each one. -->
<script lang="ts">
  import { grow } from './motion';
  import { toast } from './say.svelte';
  import { go } from './state.svelte';
</script>

<div class="region" aria-live="polite">
  {#if toast.current}
    {#key toast.current.id}
      {@const t = toast.current}
      <button
        class="toast"
        class:bad={t.bad}
        transition:grow
        onclick={() => {
          toast.current = null;
          if (t.url) go(t.url);
        }}
      >
        {#if t.title}<span class="title">{t.title}</span>{/if}
        {t.text}
      </button>
    {/key}
  {/if}
</div>

<style>
  .region { position: fixed; left: 0; right: 0; top: calc(env(safe-area-inset-top) + 12px); z-index: 50; display: flex; justify-content: center; padding: 0 16px; pointer-events: none; }
  .toast {
    pointer-events: auto; max-width: 440px; border: none; border-radius: 14px; padding: 12px 16px;
    background: var(--primary); color: var(--on-primary); font-weight: 700; font-size: 14px; line-height: 1.35; text-align: left;
    box-shadow: 0 8px 24px var(--shadow); transform-origin: top center;
  }
  .title { display: block; font-weight: 800; font-size: 13px; opacity: 0.8; }
  .toast.bad { background: var(--bad); color: var(--on-color); }
</style>
