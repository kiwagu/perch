/**
 * The database engines a page loads, its WASM files, held back by a test: until it lets them go,
 * a page cannot open an account's data. The route covers every page of the browser context and
 * hands each request on to the routes registered before it once let go.
 */

import type { BrowserContext } from '@playwright/test'

export interface HeldEngines {
  /** Lets the engines load: the requests held so far go on, and later ones are not held. */
  readonly release: () => void
}

export async function holdEngines(context: BrowserContext): Promise<HeldEngines> {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  await context.route(/\.wasm(\?.*)?$/, async (route) => {
    await released
    await route.fallback()
  })

  return { release }
}
