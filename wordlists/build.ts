// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the base dictionary (SPEC §4.9):
//   words.txt         = ENABLE ∪ SCOWL size 80 words
//   abbreviations.txt = SCOWL abbreviations not already in words.txt (valid only in games with the expanded word list)
// Run: bun wordlists/build.ts   (regenerate the scowl-80*.txt inputs first with wordlists/scowl.sh)
import { readFileSync, writeFileSync } from 'node:fs';

const WORD = /^[a-z]{2,15}$/;
// Capitalized entries (OK, Marxism) are lowercased, not dropped; proper nouns are already excluded by scowl.sh.
const read = (f: string) =>
  readFileSync(new URL(f, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((w) => w.toLowerCase())
    .filter((w) => WORD.test(w));
const write = (f: string, words: Iterable<string>) => {
  const out = [...new Set(words)].sort();
  writeFileSync(new URL(f, import.meta.url), `${out.join('\n')}\n`);
  return out;
};

const enable = read('./enable.txt');
const words = write('./words.txt', [...enable, ...read('./scowl-80.txt')]);
const inWords = new Set(words);
const abbreviations = write('./abbreviations.txt', read('./scowl-80-abbr.txt').filter((w) => !inWords.has(w)));
console.log(`${words.length} words (${words.length - new Set(enable).size} beyond ENABLE), ${abbreviations.length} abbreviations`);
