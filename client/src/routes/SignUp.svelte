<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { show } from '../lib/motion';
  import { go, home, type Me, session } from '../lib/state.svelte';

  type Check = { valid: boolean; invitedBy: string | null };

  let inviteCode = $state('');
  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let invite = $state<Check | null>(null);

  const normalized = $derived(inviteCode.toUpperCase().replace(/[^0-9A-Z]/g, ''));

  // Check the code as soon as it's complete; the other fields stay disabled until it checks out (SPEC §6).
  $effect(() => {
    const code = normalized;
    invite = null;
    if (code.length !== 12) return;
    api<Check>('/invites/check', { method: 'POST', body: { inviteCode: code } })
      .then((r) => {
        if (code === normalized) invite = r;
      })
      .catch(() => {});
  });

  const matches = $derived(password === confirm);
  const ready = $derived(!!invite?.valid && !!username && !!displayName && password.length >= 10 && matches);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await api('/auth/signup', { method: 'POST', body: { inviteCode, username, displayName, password } });
      session.me = await api<Me>('/me');
      go(home());
    } catch (err) {
      sayError(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; padding: 0 8px">
    <button class="iconbtn" aria-label="Back to sign in" onclick={() => go('/')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
  </header>

  <form onsubmit={submit} style="padding: 0 20px 24px; display: flex; flex-direction: column; gap: 16px; flex-grow: 1">
    <div class="stack" style="margin-bottom: 4px">
      <h1 class="h1" style="font-size: 32px">Create your account</h1>
      <p class="lead" style="font-size: 15px">You need an invite code from someone already on Tileroom. Each code works once.</p>
    </div>

    <div class="stack">
      <label for="ic" class="label">Invite code</label>
      <input
        id="ic"
        class="field code"
        class:ok={invite?.valid}
        bind:value={inviteCode}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
      />
      {#if invite?.valid}
        <span class="good" transition:show>Valid invite{invite.invitedBy ? ` from ${invite.invitedBy}` : ''}</span>
      {:else if invite}
        <span class="error" transition:show>This code isn't valid or was already used</span>
      {/if}
    </div>

    <fieldset disabled={!invite?.valid}>
      <div class="stack">
        <label for="su" class="label">Username</label>
        <input id="su" class="field" bind:value={username} autocomplete="username" autocapitalize="none" spellcheck="false" />
        <span class="hint">3–20 letters, numbers or _ · how you sign in</span>
      </div>
      <div class="stack">
        <label for="dn" class="label">Display name</label>
        <input id="dn" class="field" bind:value={displayName} autocomplete="nickname" maxlength="24" />
        <span class="hint">What other players see</span>
      </div>
      <div class="stack">
        <label for="np" class="label">Password</label>
        <input id="np" class="field" type="password" bind:value={password} autocomplete="new-password" />
        <span class="hint">At least 10 characters. Your phone can save it for you.</span>
      </div>
      <div class="stack">
        <label for="cp" class="label">Confirm password</label>
        <input id="cp" class="field" type="password" bind:value={confirm} autocomplete="new-password" />
        {#if confirm}
          <span class={matches ? 'good' : 'error'} transition:show>{matches ? 'Passwords match' : "Passwords don't match"}</span>
        {/if}
      </div>
    </fieldset>

    <button class="primary" type="submit" disabled={!ready || busy} style="margin-top: auto">Create account</button>
  </form>
</main>

<style>
  .code { font-size: 20px; font-weight: 800; letter-spacing: 0.1em; }
  .code.ok { border-color: var(--p2-bg); }
  fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 16px; }
  fieldset:disabled { opacity: 0.5; }
</style>
