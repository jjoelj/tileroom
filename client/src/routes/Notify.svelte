<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { api } from '../lib/api';
  import { pushSupported, subscribe } from '../lib/push';
  import { device, session } from '../lib/state.svelte';

  const permission = $derived(pushSupported() ? device.permission : 'unsupported');
  let error = $state('');
  let hint = $state('');
  let busy = $state(false);

  const ua = navigator.userAgent;
  const steps = /iPhone|iPad|iPod/.test(ua)
    ? 'Open Settings → Notifications → Tileroom and allow notifications.'
    : /Android/.test(ua)
      ? 'Long-press the Tileroom icon → App info → Notifications, and turn them on.'
      : "Open this site's settings in your browser (the icon left of the address) and allow notifications.";

  // Only ever asked from this tap (SPEC §9.6).
  async function enable() {
    busy = true;
    error = '';
    hint = '';
    try {
      device.permission = await Notification.requestPermission();
      // Edge (and Chrome's quiet mode) can hide the prompt behind an address-bar icon and answer "no decision".
      if (device.permission === 'default') {
        hint = 'Your browser hid the request. Look for a bell or lock icon in the address bar, choose Allow, then tap again.';
      }
      if (device.permission !== 'granted') return;
      await subscribe();
      await api('/push/test', { method: 'POST' }).catch(() => {});
      if (session.me) session.me.pushReady = true;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      error = /permission denied|incognito|private/i.test(why)
        ? "This window can't receive notifications. Private windows don't support them; use a normal window or the installed app."
        : `Couldn't turn on notifications: ${why}`;
    } finally {
      busy = false;
    }
  }

  function check() {
    device.permission = Notification.permission;
    if (device.permission === 'granted') void enable();
  }
</script>

<main class="screen">
  <div style="padding-top: 64px; display: flex; flex-direction: column; gap: 18px">
    <span class="label">Last step</span>
    <h1 class="h1" style="font-size: 36px">Turn on notifications</h1>
    <p class="lead">Games here are slow and async. Notifications are the only way you'll know it's your turn, so they're required.</p>
  </div>

  <div aria-hidden="true" class="card preview">
    <span class="icon">T</span>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-weight: 800; font-size: 14px">Your turn in Thursday Night</span>
      <span style="font-size: 14px; color: var(--body)">Ben played SPICY for 24.</span>
    </div>
  </div>

  <div style="margin-top: auto; padding: 24px 0 28px; display: flex; flex-direction: column; gap: 12px">
    {#if permission === 'unsupported'}
      <p class="error">This browser can't show notifications. Install Tileroom to your home screen and open it from there.</p>
    {:else if permission === 'denied'}
      <p class="lead" style="font-size: 15px"><b>Notifications are blocked.</b> {steps}</p>
      <button class="primary" onclick={check}>Check again</button>
    {:else}
      {#if hint}<p class="lead" role="status" style="font-size: 15px">{hint}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" onclick={enable} disabled={busy}>Turn on notifications</button>
      <div style="text-align: center; font-size: 13px; line-height: 1.45; color: var(--muted)">Only for your games: your turn, starts and ends.</div>
    {/if}
  </div>
</main>

<style>
  .preview { margin-top: 28px; border-radius: 18px; padding: 14px; display: flex; gap: 12px; box-shadow: 0 8px 24px rgba(22, 22, 26, 0.08); }
  .icon { width: 40px; height: 40px; border-radius: 10px; background: var(--tile); color: var(--tile-fg); font-weight: 800; font-size: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
</style>
