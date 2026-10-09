<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- ponytail: generic steps; the per-platform install gate is milestone 7 -->
<script lang="ts">
  import { inviteIn, route, session } from '../lib/state.svelte';

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // A link can't carry data into the installed app (SPEC §9.6), so show the code to type in there.
  const invite = inviteIn(route.path);
  const code = invite?.code.toUpperCase();
</script>

<main class="screen">
  <div style="padding-top: 64px; display: flex; flex-direction: column; gap: 16px">
    <div class="brand" aria-hidden="true"><span>T</span><span>R</span></div>
    {#if code}
      <span class="label">You're invited to a {invite?.kind}</span>
      <div style="font-family: var(--display); font-weight: 800; font-size: 44px; letter-spacing: 0.08em">{code}</div>
      <p class="lead"><b>Install Tileroom, then enter this code</b> with "Join game or group".</p>
    {/if}
    <h1 class="h1" style="font-size: 36px">Install Tileroom</h1>
    <p class="lead">Tileroom runs as an app on your home screen, so it can tell you when it's your turn. If the app asks you to sign in, you're <b>@{session.me?.username}</b>.</p>
    {#if ios}
      <ol class="lead" style="padding-left: 20px">
        <li>Tap <b>Share</b> in the toolbar.</li>
        <li>Choose <b>Add to Home Screen</b>.</li>
        <li>Open Tileroom from your home screen.</li>
      </ol>
    {:else}
      <ol class="lead" style="padding-left: 20px">
        <li>Open your browser menu.</li>
        <li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li>
        <li>Open Tileroom from your home screen or app launcher.</li>
      </ol>
    {/if}
  </div>
</main>
