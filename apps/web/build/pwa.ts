/**
 * The app as an installable web app that opens without a network: the web app manifest and a
 * service worker written by `vite-plugin-pwa` (Workbox). The worker caches this build's shell
 * when it installs (its page and its hashed scripts and styles, never the source maps or the
 * large WASM modules); a page load goes to the network, and only when the network fails gets
 * this build's cached page, which is kept under a name no address uses (`SHELL`), so no page
 * load, `/index.html` included, is ever answered from the cache while the server answers; files
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

/**
 * Where the cached page lives: an address the app never links to, which the front answers with
 * the page as it answers every address that is not a file.
 */
const SHELL = '/offline-shell'

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
      // The page is cached under `SHELL`, not its own name, so no page load matches it.
      manifestTransforms: [
        (entries) =>
          Promise.resolve({
            manifest: entries.map((entry) =>
              entry.url === 'index.html' ? { ...entry, url: SHELL } : entry,
            ),
            warnings: [],
          }),
      ],
      navigateFallback: null,
      directoryIndex: null,
      // A cached file is the same file whatever its query says (a hashed name names its content).
      ignoreURLParametersMatching: [/.*/],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: PAGE,
          // No copy of a page is kept: offline, this build's own cached page answers any address.
          handler: 'NetworkOnly',
          options: { precacheFallback: { fallbackURL: SHELL } },
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
