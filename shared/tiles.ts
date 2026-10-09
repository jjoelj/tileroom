// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bag, RandomInt } from './types';

export const RACK_SIZE = 7;
export const BLANK = '?';

const counts = (s: string): Record<string, number> =>
  Object.fromEntries(s.split(' ').map((t) => [t[0]!, Number(t.slice(1))]));

export const VALUES = counts(
  'A1 B3 C3 D2 E1 F4 G2 H3 I1 J10 K5 L1 M3 N1 O1 P3 Q10 R1 S1 T1 U1 V6 W4 X8 Y4 Z10 ?0',
);

export const BAGS: Record<100 | 150, Bag> = {
  100: counts('A9 B2 C2 D4 E11 F2 G3 H2 I9 J1 K1 L4 M2 N6 O8 P2 Q1 R6 S4 T6 U4 V2 W2 X1 Y2 Z1 ?3'),
  150: counts('A14 B3 C3 D6 E17 F3 G4 H3 I14 J1 K1 L6 M3 N9 O13 P3 Q1 R9 S6 T9 U6 V3 W3 X1 Y3 Z1 ?5'),
};

export const bagCount = (bag: Bag) => Object.values(bag).reduce((a, b) => a + b, 0);

/** Draws up to `n` tiles uniformly from the multiset, mutating `bag`. */
export function draw(bag: Bag, n: number, randomInt: RandomInt): string[] {
  const out: string[] = [];
  for (let total = bagCount(bag); out.length < n && total > 0; total--) {
    let i = randomInt(total);
    for (const [letter, k] of Object.entries(bag)) {
      if (i < k) {
        out.push(letter);
        if (k === 1) delete bag[letter];
        else bag[letter] = k - 1;
        break;
      }
      i -= k;
    }
  }
  return out;
}

export function returnToBag(bag: Bag, letters: string[]) {
  for (const l of letters) bag[l] = (bag[l] ?? 0) + 1;
}
