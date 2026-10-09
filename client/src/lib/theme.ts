// SPDX-License-Identifier: AGPL-3.0-or-later
// Light/dark theme: a per-device preference. app.css holds the palettes; this only flips data-theme on <html>.
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'tileroom:theme';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the theme still applies for this visit
  }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
