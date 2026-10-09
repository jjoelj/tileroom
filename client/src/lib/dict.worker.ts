// SPDX-License-Identifier: AGPL-3.0-or-later
// Holds the word lists off the main thread (SPEC §9.3) and answers "which of these aren't words?".
/// <reference lib="webworker" />
import { parseWordList } from '../../../shared/dictionary';

const lists = new Map<string, Promise<Set<string>>>();
const load = (url: string) => {
  let p = lists.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => parseWordList(await r.text()));
    lists.set(url, p);
  }
  return p;
};

type Req = { id: number; words: string[]; urls: string[] } | { id: number; preload: string[] };

self.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  if ('preload' in req) return void req.preload.forEach(load);
  const sets = await Promise.all(req.urls.map(load));
  const invalid = req.words.filter((w) => !sets.some((s) => s.has(w)));
  self.postMessage({ id: req.id, invalid });
};
