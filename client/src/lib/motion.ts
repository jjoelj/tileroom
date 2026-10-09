// SPDX-License-Identifier: AGPL-3.0-or-later
// One motion vocabulary for the app. Nothing should appear or disappear without one of these.
import { cubicOut } from 'svelte/easing';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A duration, or 0 when the user asked for less motion. */
export const ms = (n: number) => (reduced ? 0 : n);

/** Tiles and badges: scale and fade in/out. `quiet` makes it instant (a drag has already shown the move). */
export function pop(_node: Element, { quiet = false, delay = 0, duration = 180 } = {}) {
  return { delay: quiet ? 0 : delay, duration: quiet ? 0 : ms(duration), easing: cubicOut, css: (t: number) => `transform: scale(${0.6 + 0.4 * t}); opacity: ${t}` };
}

/** Sheets: slide up from the bottom edge. */
export function rise(_node: Element, { duration = 240 } = {}) {
  return { duration: ms(duration), easing: cubicOut, css: (t: number) => `transform: translateY(${(1 - t) * 100}%)` };
}

/** Menus and popovers: a small grow from their anchor plus fade. */
export function grow(_node: Element, { duration = 150 } = {}) {
  return { duration: ms(duration), easing: cubicOut, css: (t: number) => `transform: scale(${0.94 + 0.06 * t}); opacity: ${t}` };
}

/** Text and blocks: fade, optionally drifting up a few px. */
export function show(_node: Element, { duration = 160, y = 0, delay = 0 } = {}) {
  return { delay, duration: ms(duration), easing: cubicOut, css: (t: number) => `opacity: ${t}; transform: translateY(${(1 - t) * y}px)` };
}
