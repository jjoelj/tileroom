<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { api } from '../lib/api';
  import { show } from '../lib/motion';
  import { say } from '../lib/say.svelte';
  import { pushSupported, subscribe } from '../lib/push';
  import { device, session } from '../lib/state.svelte';

  const permission = $derived(pushSupported() ? device.permission : 'unsupported');
  let hint = $state('');
  let busy = $state(false);

  const ua = navigator.userAgent;
  // Desktop browsers put both the hidden-request bell and site settings in the address bar: point at it.
  const desktop = !/iPhone|iPad|iPod|Android/.test(ua) && !(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const steps = /iPhone|iPad|iPod/.test(ua)
    ? 'Open Settings → Notifications → Tileroom and allow notifications.'
    : /Android/.test(ua)
      ? 'Long-press the Tileroom icon → App info → Notifications, and turn them on.'
      : 'Use the icon at the left end of the address bar (arrow above), set Notifications to Allow, then check again.';

  // Only ever asked from this tap (SPEC §9.6).
  async function enable() {
    busy = true;
    hint = '';
    try {
      // Edge (and Chrome's quiet mode) hide the prompt behind an address-bar icon and leave the request pending,
      // or answer "no decision". Either way, say where to look.
      const hidden = 'Your browser hid the request. Look for a bell icon at the right end of the address bar and choose Allow.';
      const slow = setTimeout(() => (hint = hidden), 5000);
      device.permission = await Notification.requestPermission().finally(() => clearTimeout(slow));
      hint = device.permission === 'default' ? `${hidden} Then tap again.` : '';
      if (device.permission !== 'granted') return;
      await subscribe();
      await api('/push/test', { method: 'POST' }).catch(() => {});
      if (session.me) session.me.pushReady = true;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      say(
        /permission denied|incognito|private/i.test(why)
        ? "This window can't receive notifications. Private windows don't support them; use a normal window or the installed app."
          : `Couldn't turn on notifications: ${why}`,
        { bad: true },
      );
    } finally {
      busy = false;
    }
  }

  function check() {
    device.permission = Notification.permission;
    if (device.permission === 'granted') void enable();
  }
</script>

{#if desktop && (permission === 'denied' || hint)}
  <!-- Hidden request: Chrome/Edge show a bell at the right end. Blocked: site settings live at the left end. -->
  <div class="pointer" class:left={permission === 'denied'} role="status" transition:show>
    <svg class="arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4M5 11l7-7 7 7" /></svg>
    <span>
      {#if permission === 'denied'}
        Click the icon at the <b>left</b> end of the address bar, then set <b>Notifications</b> to <b>Allow</b>.
      {:else}
        Click the <b>bell</b> at the <b>right</b> end of the address bar, then choose <b>Allow</b>.
      {/if}
    </span>
  </div>
{/if}

<main class="screen">
  <div style="padding-top: 64px; display: flex; flex-direction: column; gap: 18px">
    <span class="label">Last step</span>
    <h1 class="h1" style="font-size: 36px">Turn on notifications</h1>
    <p class="lead">Games here are slow and async. Notifications are the only way you'll know it's your turn, so they're required.</p>
  </div>

  <div aria-hidden="true" class="card preview">
    <span class="icon tile-face">T</span>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <span style="font-weight: 800; font-size: 14px">Sam &amp; Ben</span>
      <span style="font-size: 14px; color: var(--body)">Your turn. Ben played SPICY (24)</span>
    </div>
  </div>

  <div style="margin-top: auto; padding: 24px 0 28px; display: flex; flex-direction: column; gap: 12px">
    {#if permission === 'unsupported'}
      <p class="error">This browser can't show notifications. Install Tileroom to your home screen and open it from there.</p>
    {:else if permission === 'denied'}
      <p class="lead" style="font-size: 15px"><b>Notifications are blocked.</b> {steps}</p>
      <button class="primary" onclick={check}>Check again</button>
    {:else}
      {#if hint && !desktop}<p class="lead" role="status" transition:show style="font-size: 15px">{hint}</p>{/if}
      <button class="primary" onclick={enable} disabled={busy}>Turn on notifications</button>
      <div style="text-align: center; font-size: 13px; line-height: 1.45; color: var(--muted)">Only for your games: your turn, starts and ends.</div>
    {/if}
  </div>
</main>

<style>
  .preview { margin-top: 28px; border-radius: 18px; padding: 14px; display: flex; gap: 12px; box-shadow: 0 8px 24px var(--shadow); }
  .pointer { position: fixed; top: 8px; right: 16px; z-index: 10; max-width: 300px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; padding: 12px 14px; border-radius: 14px; background: var(--primary); color: var(--on-primary); font-size: 15px; line-height: 1.4; font-weight: 600; box-shadow: 0 10px 30px var(--shadow); }
  .pointer.left { right: auto; left: 16px; align-items: flex-start; }
  .arrow { animation: nudge 1s ease-in-out infinite; }
  @keyframes nudge { 50% { transform: translateY(-6px); } }
  @media (prefers-reduced-motion: reduce) { .arrow { animation: none; } }
  .icon { width: 40px; height: 40px; border-radius: 10px; font-size: 18px; flex-shrink: 0; }
</style>
