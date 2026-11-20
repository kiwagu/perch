/**
 * The code of the app's start refused by the browser, as when the network drops it: the chunk
 * the bundler names after the start's module (`apps/web/src/composition/browser.ts`), which a
 * page loads after its first frame. The route covers every page of the browser context.
 */

import type { BrowserContext } from '@playwright/test'

/** The chunk of the start's code, `/assets/browser-<hash>.js`, as the build names it. */
const START_CODE = /\/assets\/browser-[\w-]+\.js(\?.*)?$/

export async function refuseStartCode(context: BrowserContext): Promise<void> {
  await context.route(START_CODE, (route) => route.abort('internetdisconnected'))
}
