<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { api } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { go } from '../lib/state.svelte';

  // Fragments never reach server access logs. Remove it from the address bar after capture.
  const token = location.hash.slice(1);
  history.replaceState(history.state, '', location.pathname);
  let password = $state('');
  let confirmation = $state('');
  let busy = $state(false);
  let done = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (password !== confirmation || busy) return;
    busy = true;
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      password = confirmation = '';
      done = true;
    } catch (err) {
      sayError(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <h1 class="h1" style="margin-top: 64px">Reset password</h1>
  {#if done}
    <p class="lead">Password updated. Sign in with your new password.</p>
    <button class="primary" onclick={() => location.assign('/')}>Go to sign in</button>
  {:else if !token}
    <p class="lead">Open the full reset link from your admin. If it has expired, ask for a new one.</p>
    <button class="secondary" onclick={() => go('/')}>Back</button>
  {:else}
    <p class="lead">Choose a new password. This will sign out existing sessions.</p>
    <form onsubmit={submit} style="display: flex; flex-direction: column; gap: 16px; margin-top: 24px">
      <div class="stack">
        <label for="new-password" class="label">New password</label>
        <input id="new-password" class="field" type="password" bind:value={password} autocomplete="new-password" minlength="10" maxlength="128" required />
      </div>
      <div class="stack">
        <label for="confirm-password" class="label">Confirm password</label>
        <input id="confirm-password" class="field" type="password" bind:value={confirmation} autocomplete="new-password" minlength="10" maxlength="128" required />
      </div>
      {#if confirmation}<p aria-live="polite">{password === confirmation ? 'Passwords match' : "Passwords don't match"}</p>{/if}
      <button class="primary" type="submit" disabled={busy || !password || password !== confirmation}>{busy ? 'Updating…' : 'Set password'}</button>
    </form>
  {/if}
</main>
