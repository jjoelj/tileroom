<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- A game on a list (the lobby, a group's page): everyone's score and name (me first; a crown on the winner), then
     how long ago its last move or its end was, and what to do. A game still in its lobby shows who's in. -->
<script lang="ts" module>
  export type GameSummary = {
    id: string;
    status: 'lobby' | 'active' | 'finished';
    currentSeat: number;
    turnStartedAt: number | null;
    finishedAt: number | null;
    mySeat: number | null; // null: watching
    group?: { id: string; name: string } | null;
    players: { seat: number; displayName: string; score: number; colorIndex: number }[];
  };
</script>

<script lang="ts">
  import { show } from './motion';
  import { ago, names, plural } from '../../../shared/plural';
  import { MAX_PLAYERS } from '../../../shared/rules';
  import { go } from './state.svelte';

  /** `action`: what the foot offers instead of whose turn it is (Join, Watch); `onclick` replaces opening the game. */
  let { g, action, onclick }: { g: GameSummary; action?: string; onclick?: () => void } = $props();

  const open = () => (onclick ? onclick() : go(`/games/${g.id}`));
  const tag = $derived(g.group ? `${g.group.name} · ` : '');
  // Games have no names: they're called by who else is in them.
  const title = $derived(names(g.players.filter((p) => p.seat !== g.mySeat).map((p) => p.displayName)) || 'Waiting for players');
  const turnOf = $derived(g.players.find((p) => p.seat === g.currentSeat)?.displayName ?? '');
  /** Me first, then the others in turn order. */
  const meFirst = $derived([...g.players].sort((a, b) => (a.seat === g.mySeat ? -1 : b.seat === g.mySeat ? 1 : a.seat - b.seat)));
  const best = $derived(Math.max(...g.players.map((p) => p.score)));
  const mine = $derived(g.status === 'active' && g.currentSeat === g.mySeat);
</script>

{#if g.status === 'lobby'}
  <button class="card game" in:show={{ y: 8 }} onclick={open}>
    <span class="row">
      <span class="name">{title}</span>
      {#if action}<span class="play">{action}</span>{/if}
    </span>
    <span class="sub">{tag}{plural(g.players.length, 'player', 'players')} joined · up to {MAX_PLAYERS}</span>
  </button>
{:else}
  <button class="card game" class:mine class:done={g.status === 'finished'} in:show={{ y: 8 }} onclick={open}>
    <span class="players">
      {#each meFirst as p (p.seat)}
        <span class="pl" class:turn={g.status === 'active' && p.seat === g.currentSeat && !mine} style="color: var(--p{p.colorIndex % 6})">
          <span class="score"
            >{p.score}{#if g.status === 'finished' && p.score === best}<svg class="crown" viewBox="0 0 24 24" aria-label="won"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>{/if}</span
          >
          <span class="pn">{p.seat === g.mySeat ? 'You' : p.displayName}</span>
        </span>
      {/each}
    </span>
    <span class="foot">
      <span class="sub">{tag}{ago(Date.now() - (g.status === 'finished' ? g.finishedAt! : g.turnStartedAt!))}</span>
      <span class="rule"></span>
      {#if mine}<span class="play">Play</span>{:else if action}<span class="play quiet">{action}</span>{:else if g.status === 'active'}<span class="sub">{turnOf}'s turn</span>{/if}
    </span>
  </button>
{/if}

<style>
  .game { width: 100%; text-align: left; border: none; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .game.mine { outline: 2px solid var(--p0); }
  .game.done { background: transparent; border: 1.5px solid var(--line); border-radius: 16px; }
  .players { display: flex; flex-wrap: wrap; gap: 12px 20px; }
  .pl { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
  .score { display: flex; align-items: center; gap: 4px; font-family: var(--display); font-weight: 800; font-size: 20px; }
  .crown { width: 16px; height: 16px; fill: var(--gold); }
  .pn { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 9em; }
  .pl.turn .pn { text-decoration: underline 2px; text-underline-offset: 3px; } /* whose turn it is */
  .foot { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
  .foot .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rule { flex: 1; min-width: 12px; height: 1px; background: var(--line); }
  .play { flex: none; font-size: 14px; font-weight: 800; color: var(--on-color); background: var(--p0-bg); padding: 8px 22px; border-radius: 999px; }
  .play.quiet { background: var(--well); color: var(--ink); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .name { font-weight: 800; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 13px; color: var(--muted); }
</style>
