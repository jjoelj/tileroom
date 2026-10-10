<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ms, show } from '../lib/motion';
  import { say } from '../lib/say.svelte';
  import { api } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { askPassword, confirm, prompt } from '../lib/ask.svelte';
  import { back, go, session } from '../lib/state.svelte';
  import { getTheme, setTheme, type Theme } from '../lib/theme';

  let theme = $state<Theme>(getTheme());
  let tested = $state('');

  async function testPush() {
    tested = 'Sending…';
    tested = await api('/push/test', { method: 'POST' }).then(
      () => 'Sent. Check your notifications',
      () => "Couldn't send. Try again",
    );
  }

  async function rename() {
    const me = session.me;
    if (!me) return;
    const displayName = await prompt({
      title: 'Change your name',
      body: 'This is what other players see in games and groups.',
      action: 'Save',
      input: { label: 'Display name', value: me.displayName, maxlength: 24 },
    });
    if (!displayName || displayName === me.displayName) return;
    await api('/me/settings', { method: 'PATCH', body: { displayName } }).then(
      () => (me.displayName = displayName),
      () => {},
    );
  }

  // Change password (SPEC §9.6): confirm field with a live match check; other devices get signed out.
  let changing = $state(false);
  let current = $state('');
  let password = $state('');
  let confirmPw = $state('');
  let saving = $state(false);
  const pwMatch = $derived(password === confirmPw);
  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    try {
      await api('/me/password', { method: 'POST', body: { current, password } });
      changing = false;
      current = password = confirmPw = '';
      say('Password changed. Your other devices were signed out.');
    } catch (err) {
      sayError(err);
    } finally {
      saving = false;
    }
  }

  async function setGlobal(on: boolean) {
    const me = session.me;
    if (!me) return;
    await api('/me/settings', { method: 'PATCH', body: { showOnGlobal: on } }).then(() => (me.showOnGlobal = on), sayError);
  }

  // Deleting: confirm, then the password. Admins can't (the server refuses; no button for them).
  async function deleteAccount() {
    const ok = await confirm({
      title: 'Delete your account?',
      body: "You'll be signed out everywhere and removed from your groups. Games you haven't started yet are cancelled or left; past games show you as Deleted player. This can't be undone.",
      action: 'Continue',
      danger: true,
    });
    if (!ok) return;
    const password = await askPassword({ title: 'Enter your password', body: 'To confirm it is you.', action: 'Delete my account', danger: true });
    if (!password) return;
    try {
      await api('/me', { method: 'DELETE', body: { password } });
      session.me = null;
      go('/');
    } catch (err) {
      sayError(err);
    }
  }

  async function signOut() {
    if (!(await confirm({ title: 'Sign out?', body: "You'll need your username and password to sign back in.", action: 'Sign out', danger: true }))) return;
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.me = null;
    go('/');
  }
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back" onclick={() => back()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px">Settings</h1>
  </header>

  <div style="padding: 4px 16px 32px; display: flex; flex-direction: column; gap: 18px">
    <div class="card item">
      <span class="grow">
        <span style="font-weight: 800; display: block">{session.me?.displayName}</span>
        <span class="hint">@{session.me?.username}</span>
      </span>
      <button class="secondary" style="width: auto; height: 44px; padding: 0 14px; flex-shrink: 0" onclick={rename}>Change name</button>
    </div>

    <button class="secondary" aria-expanded={changing} onclick={() => (changing = !changing)}>Change password</button>
    {#if changing}
      <form class="stack" onsubmit={changePassword} transition:slide={{ duration: ms(180) }}>
        <input type="text" autocomplete="username" value={session.me?.username} hidden readonly />
        <label for="cur" class="label">Current password</label>
        <input id="cur" class="field" type="password" bind:value={current} autocomplete="current-password" />
        <label for="np" class="label">New password</label>
        <input id="np" class="field" type="password" bind:value={password} autocomplete="new-password" />
        <span class="hint">At least 10 characters. Your other devices will be signed out.</span>
        <label for="cp" class="label">Confirm new password</label>
        <input id="cp" class="field" type="password" bind:value={confirmPw} autocomplete="new-password" />
        {#if confirmPw}
          <span class={pwMatch ? 'good' : 'error'} transition:show>{pwMatch ? 'Passwords match' : "Passwords don't match"}</span>
        {/if}
        <button class="primary" disabled={!current || password.length < 10 || !pwMatch || saving}>Save password</button>
      </form>
    {/if}

    <div>
      <span class="label">Theme</span>
      <div class="themes" role="radiogroup" aria-label="Theme">
        {#each ['system', 'light', 'dark'] as const as t (t)}
          <button
            role="radio"
            aria-checked={theme === t}
            class:on={theme === t}
            onclick={() => {
              theme = t;
              setTheme(t);
            }}>{t[0]!.toUpperCase() + t.slice(1)}</button
          >
        {/each}
      </div>
    </div>

    <label class="card toggle">
      <span class="grow"><span style="font-weight: 700">Show me on the global leaderboard</span><span class="hint">Group leaderboards always show their members.</span></span>
      <input type="checkbox" checked={session.me?.showOnGlobal} onchange={(e) => setGlobal(e.currentTarget.checked)} />
    </label>

    <button class="secondary" onclick={testPush}>{tested || 'Send test notification'}</button>
    <button class="secondary" onclick={() => go('/whats-new')}>What's new</button>
    {#if session.me?.isAdmin}<button class="secondary" onclick={() => go('/admin')}>Admin</button>{/if}

    <button class="secondary signout" onclick={signOut}>Sign out</button>
    {#if !session.me?.isAdmin}<button class="textbtn danger-text" onclick={deleteAccount}>Delete account</button>{/if}
  </div>
</main>

<style>
  .item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .toggle { display: flex; align-items: center; gap: 12px; padding: 14px 16px; min-height: 44px; }
  .toggle input { width: 24px; height: 24px; flex-shrink: 0; accent-color: var(--primary); }
  .danger-text { color: var(--bad); align-self: center; }
  .signout { color: var(--bad); border-color: var(--bad); margin-top: 12px; }
  .themes { display: flex; background: var(--well); border-radius: 12px; padding: 3px; margin-top: 8px; }
  .themes button { flex: 1; height: 38px; border: none; border-radius: 9px; background: transparent; font-weight: 700; font-size: 14px; }
  .themes button.on { background: var(--surface); }
</style>
