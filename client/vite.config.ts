// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  // SPEC §9.6: the install-gate bypass exists only in dev builds.
  if (command === 'build' && process.env.VITE_SKIP_PWA_GATE) throw new Error('VITE_SKIP_PWA_GATE must not be set for builds');
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    server: {
      port: 5173,
      allowedHosts: ['.ts.net'], // Tailscale Funnel, for testing install + push on a phone
      proxy: { '/api': 'http://127.0.0.1:3000' },
      fs: { allow: ['..'] }, // the word lists live in /wordlists
    },
    plugins: [
      svelte(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest: {
          name: 'Tileroom',
          short_name: 'Tileroom',
          description: 'A crossword-style tile game for you and your people.',
          display: 'standalone',
          start_url: '/',
          theme_color: '#16161A',
          background_color: '#F5F4EF',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: { globPatterns: ['**/*.{js,css,html,woff2,png,txt}'], maximumFileSizeToCacheInBytes: 4_000_000 },
        devOptions: { enabled: true, type: 'module' },
      }),
    ],
  };
});
