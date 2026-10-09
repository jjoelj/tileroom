<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- ponytail: generic steps; the per-platform install gate is milestone 7 -->
<script lang="ts">
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
</script>

<main class="screen">
  <div style="padding-top: 64px; display: flex; flex-direction: column; gap: 16px">
    <div class="brand" aria-hidden="true"><span>T</span><span>R</span></div>
    <h1 class="h1" style="font-size: 36px">Install Tileroom</h1>
    <p class="lead">Tileroom runs as an app on your home screen, so it can tell you when it's your turn.</p>
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
