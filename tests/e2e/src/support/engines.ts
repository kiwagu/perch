/**
 * The database engines a page loads, its WASM files, held back by a test: until it lets them go,
 * a page cannot open an account's data. `holdEngines` covers every page of the browser context;
 * `holdTabEngines` one page alone, the engines its database worker fetches included, so another
 * tab of the same browser still opens an account's data. Each hands a request on to the routes
 * registered before it once let go.
 */

import type { BrowserContext, Page } from '@playwright/test'

export interface HeldEngines {
  /** Lets the engines load: the requests held so far go on, and later ones are not held. */
  readonly release: () => void
}

/** One tab's engines, held until the test lets them load or refuses them. */
export interface HeldTabEngines extends HeldEngines {
  /** Refuses the engines, as when the network drops them: the tab's data cannot open. */
  readonly refuse: () => void
}

const WASM = /\.wasm(\?.*)?$/

export async function holdEngines(context: BrowserContext): Promise<HeldEngines> {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  await context.route(WASM, async (route) => {
    await released
    await route.fallback()
  })

  return { release }
}

export async function holdTabEngines(page: Page): Promise<HeldTabEngines> {
  let decide: (load: boolean) => void = () => {}
  const decided = new Promise<boolean>((resolve) => {
    decide = resolve
  })

  await page.route(WASM, async (route) => {
    await ((await decided) ? route.fallback() : route.abort('internetdisconnected'))
  })

  return { release: () => decide(true), refuse: () => decide(false) }
}
