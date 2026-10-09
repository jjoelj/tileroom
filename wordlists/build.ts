// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds client/public/words/words.txt, the base dictionary (SPEC §4.9):
//   ENABLE ∪ filtered SCOWL ∪ hand-picked short words.
// Run: bun wordlists/build.ts   (refresh scowl-85.txt first with the URL below if you want newer words)
// SCOWL source: https://app.aspell.net/create?max_size=85&spelling=US&spelling=GBs&spelling=GBz&spelling=CA&spelling=AU&max_variant=1&diacritic=strip&special=hacker&download=wordlist&encoding=utf-8&format=inline
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const WORD = /^[a-z]{2,15}$/;
const lines = (text: string) => text.split(/\r?\n/).map((w) => w.trim());

// Short SCOWL additions are mostly abbreviations (adj, bldg, misc), so 2–4 letter words only come from this list.
const SHORT = `
  qi za ok oi zen covid app apps emo emos meh duh doh eek pwn pwns fab uni unis ute utes moi dox doxx mic mics
  oik oiks poo poos tum tums och blog blogs camo chai cred dosh faff fest glam goth goths hiya meme mega meds
  megs mosh perp perv soba spam stim tech udon vape vlog wiki wifi yada woop whup zine berk blag gawd naff
  niff nong rego rort swiz tizz yeps choc biog gite hoon pacy wank chav grok grep`;

// SCOWL abbreviations and suffix fragments that slip past the length rule.
const DROP = 'assoc contd equiv hdqrs illus imper instr suppl treas ation istic aceae oidea mento phile philia cracy ectomy';

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const drop = new Set(words(DROP));

const enable = lines(read('./enable.txt')).filter((w) => WORD.test(w));
const scowlText = read('./scowl-85.txt');
const scowl = lines(scowlText.slice(scowlText.indexOf('\n---') + 4)).filter(
  (w) => WORD.test(w) && w.length >= 5 && /[aeiouy]/.test(w) && !drop.has(w), // lowercase only: no proper nouns or acronyms
);

const all = new Set([...enable, ...scowl, ...words(SHORT)]);

const out = [...all].sort();
writeFileSync(new URL('../client/public/words/words.txt', import.meta.url), `${out.join('\n')}\n`);
const enableSet = new Set(enable);
console.log(`${out.length} words (${out.filter((w) => !enableSet.has(w)).length} beyond ENABLE)`);
