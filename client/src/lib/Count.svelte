<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- A number that counts to its new value instead of jumping. Starts at its first value. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { Tween } from 'svelte/motion';
  import { ms } from './motion';

  let { value }: { value: number } = $props();

  const n = new Tween(
    untrack(() => value),
    { duration: ms(320), easing: cubicOut },
  );
  $effect(() => {
    void n.set(value);
  });
</script>

{Math.round(n.current)}
