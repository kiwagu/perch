/**
 * The app as an installable web app that opens without a network: the web app manifest and a
 * service worker written by `vite-plugin-pwa` (Workbox). The worker caches the shell when it
 * installs (the page and its hashed scripts and styles, never the source maps or the large WASM
 * modules); a page load asks the network first and falls back to the cached page offline; files
 * with a hash in their name come from the cache first; each WASM module is cached the first time
 * it loads, so a device that opened its data once opens it offline. The front's API under
 * `/backend/` and the UI manifest never go through the cache: the manifest is how a tab learns
 * that a newer build is served. The worker never reloads a page itself, and the page registers
 * it in production builds only (`src/composition/service-worker.ts`).
 */

import type { PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** A page load the worker answers: any navigation but the API's and the UI manifest's. */
const PAGE = ({ request, url }: { request: Request; url: URL }): boolean =>
  request.mode === 'navigate' &&
  !url.pathname.startsWith('/backend/') &&
  !url.pathname.startsWith('/ui-manifest/')

/** A WASM module, cached the first time it loads. */
const WASM = ({ url }: { url: URL }): boolean => url.pathname.endsWith('.wasm')

export function pwa(): PluginOption {
  return VitePWA({
    // A newer worker waits; the frame's reload lets it take over (`registerSW`'s update).
    registerType: 'prompt',
    // The page registers the worker itself, in production builds only.
    injectRegister: false,
    manifest: {
      name: 'Perch',
      short_name: 'Perch',
      description:
        'A local-first foundation for web apps: your data lives on this device and syncs.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#18181b',
      theme_color: '#18181b',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      globIgnores: ['**/*.map', '**/*.wasm', 'ui-manifest/**'],
      // A page load is answered by the network first (below), not from the cache: the cached
      // page is only matched by its own name.
      navigateFallback: null,
      directoryIndex: null,
      // A cached file is the same file whatever its query says (a hashed name names its content).
      ignoreURLParametersMatching: [/.*/],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: PAGE,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'perch-pages',
            networkTimeoutSeconds: 5,
            precacheFallback: { fallbackURL: '/index.html' },
          },
        },
        {
          urlPattern: WASM,
          handler: 'CacheFirst',
          options: { cacheName: 'perch-wasm', expiration: { maxEntries: 8 } },
        },
      ],
    },
  })
}
