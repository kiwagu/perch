/**
 * The app's service worker (`build/pwa.ts` writes it), registered by production builds: the page
 * opens offline with the shell it kept. The worker never reloads a page itself. The reload the
 * frame asks for lets a waiting newer worker take over first, then loads the page again; a page
 * load goes to the network first, so either way it brings the build the server serves. A newer
 * worker is looked for each time the tab comes back to the foreground, as a newer build is.
 */

import { registerSW } from 'virtual:pwa-register'

/** Registers the worker; gives the frame's reload. */
export function serviceWorkerReload(page: Window): () => void {
  let waiting = false
  const update = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      waiting = true
    },
    onRegisteredSW: (_script, registration) => {
      page.document.addEventListener('visibilitychange', () => {
        if (page.document.visibilityState === 'visible') {
          // Offline, or the server unreachable: the next time the tab comes back asks again.
          registration?.update().catch(() => undefined)
        }
      })
    },
    onRegisterError: (error: unknown) => {
      // A browser that blocks service workers runs the app online only.
      console.warn('the service worker did not register: the app does not open offline', error)
    },
  })

  return () => {
    if (waiting) {
      void update(true)
    } else {
      page.location.reload()
    }
  }
}
