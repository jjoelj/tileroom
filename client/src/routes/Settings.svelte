<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { sayError } from '../lib/say.svelte';
  import { canShare, copy, shareText } from '../lib/share';
  import { confirm, prompt } from '../lib/ask.svelte';
  import { go, session } from '../lib/state.svelte';
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

  // Admins: unlimited invites, and who used each one.
  type Invite = { id: string; hint: string; note: string | null; createdAt: number; createdBy: string | null; usedAt: number | null; usedBy: { username: string; displayName: string } | null };
  let invites = $state<Invite[]>([]);
  let note = $state('');
  let fresh = $state(''); // the code just made: shown once, only its hash is stored
  const loadInvites = () => api<{ invites: Invite[] }>('/admin/invites').then((r) => (invites = r.invites), () => {});
  onMount(() => void (session.me?.isAdmin && loadInvites()));

  async function makeInvite(e: SubmitEvent) {
    e.preventDefault();
    try {
      fresh = (await api<{ code: string }>('/admin/invites', { method: 'POST', body: { note } })).code;
      note = '';
      void loadInvites();
    } catch (err) {
      sayError(err);
    }
  }
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const link = $derived(`${location.origin}/signup/${fresh}`);

  async function revoke(inv: Invite) {
    const ok = await confirm({ title: 'Revoke this invite?', body: `${inv.note || 'No note'} (…${inv.hint}) will stop working and be deleted.`, action: 'Revoke', danger: true });
    if (!ok) return;
    await api(`/admin/invites/${inv.id}`, { method: 'DELETE' }).catch(sayError);
    void loadInvites();
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
    <button class="iconbtn" aria-label="Back" onclick={() => go('/')}>
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

    <button class="secondary" onclick={testPush}>{tested || 'Send test notification'}</button>
    {#if session.me?.isAdmin}
      <div style="display: flex; flex-direction: column; gap: 10px">
        <span class="label">Invites</span>
        <form onsubmit={makeInvite} style="display: flex; gap: 8px">
          <input class="field" bind:value={note} placeholder="Note, e.g. for Sam" maxlength="60" autocomplete="off" aria-label="Invite note" />
          <button class="primary" style="width: auto; padding: 0 16px; flex-shrink: 0">Create invite</button>
        </form>
        {#if fresh}
          <div class="card fresh">
            <span class="code">{fresh}</span>
            <span class="hint">Shown once. Works for one signup.</span>
            <div style="display: flex; gap: 8px; margin-top: 6px">
              {#if canShare}
                <button class="secondary" onclick={() => shareText(`Join me on Tileroom: ${link}`)}>Share invite</button>
              {:else}
                <button class="secondary" onclick={() => copy(link, 'Link')}>Copy link</button>
                <button class="secondary" onclick={() => copy(fresh, 'Code')}>Copy code</button>
              {/if}
            </div>
          </div>
        {/if}
        {#each invites as inv (inv.id)}
          <div class="card item">
            <span class="grow">
              <span style="font-weight: 700">{inv.note || 'No note'} <span class="hint">…{inv.hint}</span></span>
              <span class="hint">
                {#if inv.usedBy}Used by {inv.usedBy.displayName} (@{inv.usedBy.username}) · {day(inv.usedAt!)}
                {:else}Unused · made {day(inv.createdAt)}{inv.createdBy ? ` by ${inv.createdBy}` : ' on the server'}{/if}
              </span>
            </span>
            {#if !inv.usedBy}<button class="secondary small" onclick={() => revoke(inv)}>Revoke</button>{/if}
          </div>
        {/each}
      </div>
    {/if}

    <button class="secondary signout" onclick={signOut}>Sign out</button>
  </div>
</main>

<style>
  .item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .code { font: 700 17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.05em; }
  .signout { color: var(--bad); border-color: var(--bad); margin-top: 12px; }
  .fresh { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; }
  .small { width: auto; height: 44px; padding: 0 14px; flex-shrink: 0; }
  .themes { display: flex; background: var(--well); border-radius: 12px; padding: 3px; margin-top: 8px; }
  .themes button { flex: 1; height: 38px; border: none; border-radius: 9px; background: transparent; font-weight: 700; font-size: 14px; }
  .themes button.on { background: var(--surface); }
</style>
