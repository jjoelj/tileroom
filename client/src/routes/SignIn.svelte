<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { go, home, type Me, session } from '../lib/state.svelte';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await api('/auth/login', { method: 'POST', body: { username, password } });
      session.me = await api<Me>('/me');
      go(home());
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Check your connection and try again.';
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <div style="padding-top: 64px; display: flex; flex-direction: column; gap: 16px">
    <div class="brand" aria-hidden="true"><span>T</span><span>R</span></div>
    <h1 class="h1" style="font-size: 40px; line-height: 1">Tileroom</h1>
    <p class="lead">A word game for you and your people. Invite only.</p>
  </div>

  <form onsubmit={submit} style="margin-top: 32px; display: flex; flex-direction: column; gap: 16px">
    <div class="stack">
      <label for="un" class="label">Username</label>
      <input id="un" class="field" bind:value={username} autocomplete="username" autocapitalize="none" spellcheck="false" required />
    </div>
    <div class="stack">
      <label for="pw" class="label">Password</label>
      <input id="pw" class="field" type="password" bind:value={password} autocomplete="current-password" required />
    </div>
    {#if error}<p class="error" role="alert" style="margin: 0">{error}</p>{/if}
    <button class="primary" type="submit" disabled={busy} style="margin-top: 4px">Sign in</button>
  </form>

  <div style="margin-top: auto; padding: 24px 0 28px">
    <button class="secondary" onclick={() => go('/signup')}>Have an invite code? Create account</button>
  </div>
</main>
