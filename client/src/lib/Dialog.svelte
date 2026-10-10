<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- The app's confirm/prompt sheet (see ask.svelte.ts). Escape or tapping outside cancels. -->
<script lang="ts">
  import { backCloses } from './state.svelte';
  import { dialog } from './ask.svelte';
  import { rise, show } from './motion';

  let value = $state('');
  let field = $state<HTMLInputElement>();
  let ok = $state<HTMLButtonElement>();

  // A new question: reset the field and focus it (or the confirm button).
  $effect(() => {
    const d = dialog.open;
    if (!d) return;
    value = d.input?.value ?? '';
    queueMicrotask(() => (d.input ? field?.select() : ok?.focus()));
  });

  const cancel = () => dialog.open?.done(null);
  backCloses(() => !!dialog.open, cancel);
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (dialog.open?.input && !value.trim()) return;
    dialog.open?.done(value);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && dialog.open && cancel()} />

{#if dialog.open}
  {@const d = dialog.open}
  <div class="bg" transition:show role="presentation" onclick={cancel}></div>
  <div class="sheet" transition:rise role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  <form class="body" onsubmit={submit}>
    <h2 id="dialog-title" class="h1" style="font-size: 22px">{d.title}</h2>
    {#if d.body}<p class="lead">{d.body}</p>{/if}
    {#if d.input}
      <label class="stack">
        <span class="label">{d.input.label}</span>
        <input class="field" bind:this={field} bind:value maxlength={d.input.maxlength} autocomplete="off" />
      </label>
    {/if}
    <div class="buttons">
      <button type="button" class="secondary" onclick={cancel}>Cancel</button>
      <button bind:this={ok} class="primary" class:danger={d.danger} disabled={!!d.input && !value.trim()}>{d.action}</button>
    </div>
  </form>
  </div>
{/if}

<style>
  .bg { position: fixed; inset: 0; background: var(--scrim); z-index: 40; }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; max-width: 480px; margin: 0 auto;
    background: var(--surface); border-radius: 24px 24px 0 0; padding: 24px 20px calc(20px + env(safe-area-inset-bottom));
    box-shadow: 0 -10px 30px var(--shadow);
  }
  .body { display: flex; flex-direction: column; gap: 14px; }
  .buttons { display: flex; gap: 8px; margin-top: 4px; }
  .buttons .primary { height: 52px; }
  .danger { background: var(--bad); color: var(--on-color); }
</style>
