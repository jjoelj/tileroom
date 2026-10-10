// SPDX-License-Identifier: AGPL-3.0-or-later

/** "1 win", "2 wins", "0 tiles left". The only way counts are written in copy. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Sam", "Sam & Ben", "Sam, Ben & Ana". Games have no names: they're called by who's in them. */
export const names = (list: string[]) => (list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`);

/** How long ago, from a duration in ms: "just now", "1 minute ago", "3 hours ago", "2 days ago". */
export function ago(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${plural(m, 'minute', 'minutes')} ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${plural(h, 'hour', 'hours')} ago` : `${plural(Math.floor(h / 24), 'day', 'days')} ago`;
}
