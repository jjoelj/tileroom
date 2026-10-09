// SPDX-License-Identifier: AGPL-3.0-or-later
// What's new: CHANGELOG.md bundled at build time, parsed just enough for a list (no markdown library).
import raw from '../../../CHANGELOG.md?raw';

/** AGPL: every page links the source of exactly what's running. VITE_VERSION is the tag (prod) or commit (staging); see deploy.sh. */
export const REPO = 'https://github.com/jjoelj/tileroom';
export const VERSION: string = import.meta.env.VITE_VERSION || 'dev';

export type Release = { title: string; version: string; note: string; items: string[] };

const plain = (s: string) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** "## v0.1.1 (date)" sections, newest first: an optional intro line, then "- " items (wrapped lines joined). */
export const releases: Release[] = raw
  .split(/^## /m)
  .slice(1)
  .map((section) => {
    const [title = '', ...lines] = section.split(/\r?\n/);
    const [intro = '', ...items] = lines.join('\n').split(/^- /m);
    return { title: title.trim(), version: title.trim().split(' ')[0]!, note: plain(intro), items: items.map(plain) };
  });

const SEEN_KEY = 'tileroom:seen-version';

/**
 * Releases to show once after an update: those newer than the version this device last saw. Production tags only
 * (staging changes version on every push), and nothing on a device's first visit.
 */
export function unseenReleases(): Release[] {
  if (!/^v\d/.test(VERSION)) return [];
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
    if (seen === null) localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    return []; // storage blocked: Settings > What's new still has it
  }
  if (seen === null || seen === VERSION) return [];
  const tagged = releases.filter((r) => r.version.startsWith('v'));
  const upTo = tagged.findIndex((r) => r.version === seen);
  return upTo === -1 ? tagged.slice(0, 1) : tagged.slice(0, upTo);
}

export function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    // shown again next time; harmless
  }
}
