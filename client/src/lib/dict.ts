// SPDX-License-Identifier: AGPL-3.0-or-later
import abbreviationsUrl from '../../../wordlists/abbreviations.txt?url';
import wordsUrl from '../../../wordlists/words.txt?url';

// The file names carry a content hash, so a changed list is a new URL the service worker fetches once.
let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, (invalid: string[]) => void>();

function get() {
  if (!worker) {
    worker = new Worker(new URL('./dict.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; invalid: string[] }>) => {
      waiting.get(e.data.id)?.(e.data.invalid);
      waiting.delete(e.data.id);
    };
  }
  return worker;
}

/** Starts loading the base list in the background; call after first paint. */
export const preloadWords = () => get().postMessage({ id: -1, preload: [wordsUrl] });

/** The words (uppercase) that aren't in this game's dictionary: (base ∪ house adds) − house bans (SPEC §4.9). */
export async function invalidWords(words: string[], expanded: boolean, house: { add: string[]; ban: string[] } = { add: [], ban: [] }): Promise<string[]> {
  const id = nextId++;
  const urls = expanded ? [wordsUrl, abbreviationsUrl] : [wordsUrl];
  const notInBase = await new Promise<string[]>((resolve) => {
    waiting.set(id, resolve);
    get().postMessage({ id, words: words.filter((w) => !house.add.includes(w)), urls });
  });
  return words.filter((w) => house.ban.includes(w) || notInBase.includes(w));
}
