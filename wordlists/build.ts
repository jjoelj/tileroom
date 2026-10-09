// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds wordlists/words.txt, the base dictionary (SPEC §4.9): ENABLE ∪ SCOWL size 80.
// Run: bun wordlists/build.ts   (regenerate scowl-80.txt first with wordlists/scowl.sh to pick up new SCOWL words)
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').split(/\r?\n/);
const WORD = /^[a-z]{2,15}$/;

const enable = read('./enable.txt').filter((w) => WORD.test(w));
// Abbreviations are already excluded by scowl.sh (--wo-poses abbr); capitalized entries are lowercased, not dropped.
const scowl = read('./scowl-80.txt')
  .map((w) => w.toLowerCase())
  .filter((w) => WORD.test(w));

const out = [...new Set([...enable, ...scowl])].sort();
writeFileSync(new URL('./words.txt', import.meta.url), `${out.join('\n')}\n`);
const inEnable = new Set(enable);
console.log(`${out.length} words (${out.filter((w) => !inEnable.has(w)).length} beyond ENABLE)`);
