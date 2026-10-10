<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Admins only (Settings > Admin): invites, every group with its members and game counts, and games outside groups
     (counts, and who's in the ones still going). Never boards, racks or moves. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { plural } from '../../../shared/plural';
  import { api } from '../lib/api';
  import { confirm } from '../lib/ask.svelte';
  import { sayError } from '../lib/say.svelte';
  import { canShare, copy, shareText } from '../lib/share';
  import { back, go } from '../lib/state.svelte';

  type Invite = { id: string; hint: string; createdAt: number; createdBy: string | null; usedAt: number | null; usedBy: { username: string; displayName: string } | null };
  type Group = {
    id: string;
    name: string;
    members: { username: string; displayName: string; role: 'admin' | 'member' }[];
    games: { lobby: number; active: number; finished: number };
  };
  let invites = $state<Invite[]>([]);
  type Ungrouped = { counts: Group['games']; going: { id: string; status: 'lobby' | 'active'; createdAt: number; players: string[] }[] };
  let groups = $state<Group[] | null>(null);
  let ungrouped = $state<Ungrouped | null>(null);
  let fresh = $state(''); // the code just made: shown once, only its hash is stored

  const loadInvites = () => api<{ invites: Invite[] }>('/admin/invites').then((r) => (invites = r.invites), () => {});
  onMount(() => {
    void loadInvites();
    void api<{ groups: Group[]; ungrouped: Ungrouped }>('/admin/groups').then((r) => ((groups = r.groups), (ungrouped = r.ungrouped)), sayError);
  });

  async function makeInvite() {
    try {
      fresh = (await api<{ code: string }>('/admin/invites', { method: 'POST' })).code;
      void loadInvites();
    } catch (err) {
      sayError(err);
    }
  }
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const link = $derived(`${location.origin}/signup/${fresh}`);

  async function revoke(inv: Invite) {
    const ok = await confirm({ title: 'Revoke this invite?', body: `The invite ending ${inv.hint} will stop working and be deleted.`, action: 'Revoke', danger: true });
    if (!ok) return;
    await api(`/admin/invites/${inv.id}`, { method: 'DELETE' }).catch(sayError);
    void loadInvites();
  }

  const tally = (g: Group['games']) =>
    [g.active && `${g.active} playing`, g.lobby && `${g.lobby} waiting for players`, `${plural(g.finished, 'game', 'games')} played`].filter(Boolean).join(' · ');
</script>

<main class="screen" style="padding: 0">
  <header style="height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px">
    <button class="iconbtn" aria-label="Back" onclick={() => back('/settings')}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
    <h1 class="h1" style="font-size: 22px">Admin</h1>
  </header>

  <div style="padding: 4px 16px 32px; display: flex; flex-direction: column; gap: 10px">
    <span class="label">Invites</span>
    <button class="primary" onclick={makeInvite}>Create invite</button>
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
          <span class="hint-code">…{inv.hint}</span>
          <span class="hint">
            {#if inv.usedBy}Used by {inv.usedBy.displayName} (@{inv.usedBy.username}) · {day(inv.usedAt!)}
            {:else}Unused · made {day(inv.createdAt)}{inv.createdBy ? ` by ${inv.createdBy}` : ' on the server'}{/if}
          </span>
        </span>
        {#if !inv.usedBy}<button class="secondary small" onclick={() => revoke(inv)}>Revoke</button>{/if}
      </div>
    {/each}

    <span class="label" style="margin-top: 22px">Groups</span>
    {#if groups && !groups.length}<p class="hint" style="margin: 0">No groups yet.</p>{/if}
    {#each groups ?? [] as g (g.id)}
      <div class="card group">
        <span style="font-weight: 800">{g.name}</span>
        <span class="hint">{plural(g.members.length, 'member', 'members')} · {tally(g.games)}</span>
        <ul>
          {#each g.members as m (m.username)}
            <li>{m.displayName} <span class="hint">@{m.username}{m.role === 'admin' ? ' · group admin' : ''}</span></li>
          {/each}
        </ul>
      </div>
    {/each}

    {#if ungrouped}
      <span class="label" style="margin-top: 22px">Games without a group</span>
      <div class="card group">
        <span class="hint">{tally(ungrouped.counts)}</span>
        {#if ungrouped.going.length}
          <ul>
            {#each ungrouped.going as g (g.id)}
              <li>{g.players.join(', ')} <span class="hint">{g.status === 'active' ? 'playing' : 'waiting for players'} · since {day(g.createdAt)}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</main>

<style>
  .item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .grow { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .hint-code { font: 700 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.05em; }
  .code { font: 700 17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.05em; }
  .fresh { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; }
  .small { width: auto; height: 44px; padding: 0 14px; flex-shrink: 0; }
  .group { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
  ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
</style>
