// SPDX-License-Identifier: AGPL-3.0-or-later

export type IsWord = (word: string) => boolean;

export const WORD_RE = /^[A-Z]{2,15}$/;

/** One word per line, any case; keeps only A–Z words of length 2–15. */
export const parseWordList = (text: string) =>
  new Set(text.split(/\r?\n/).map((w) => w.trim().toUpperCase()).filter((w) => WORD_RE.test(w)));

/** valid = (base ∪ add) − ban, A–Z, length 2–15 (SPEC §4.9). */
export function effectiveDictionary(
  base: ReadonlySet<string>,
  house: { add: readonly string[]; ban: readonly string[] } = { add: [], ban: [] },
): IsWord {
  const add = new Set(house.add);
  const ban = new Set(house.ban);
  return (w) => WORD_RE.test(w) && (base.has(w) || add.has(w)) && !ban.has(w);
}
