#!/usr/bin/env bun
/**
 * The start's timings against their budgets, on the production build the e2e stand serves
 * (`prepareStand` builds it and brings the stand up first), in Chromium as a Pixel 7 with the
 * CPU slowed four times and the service worker blocked: a guest's first visit (first paint, the
 * page ready) and a signed-in reload, with the browser's cache kept and cleared (first paint,
 * ready, the profile showing the account's data). Each step is timed in the page from the start
 * of its navigation, the moment its element first appears, and each number is the median of
 * the runs. The numbers move with the host's load, so this measures and never fails: the size
 * budgets are the gate (apps/web/build/size-budgets.ts). `--slow-4g` adds a slow mobile network
 * (150 ms round trip, 1.6 Mbit/s down), which the budgets, set for the local front, leave out.
 *
 *   bun run perf:measure [--runs=5] [--slow-4g]
 */

import { type CDPSession, chromium, devices, type Page } from '@playwright/test'

import { BASE_URL } from '../playwright.config'
import { APP_READY, signUp } from '../src/support/fixtures'

import { prepareStand } from './stand'

declare global {
  interface Window {
    __perchSteps?: Record<string, number>
  }
}

/** The steps timed by their element, in the order the start reaches them. */
const STEPS = { ready: APP_READY, profile: '[data-testid="user.profile.heading"]' }
const PAINT = 'first paint'

const SCENARIOS = [
  { name: 'guest, first visit', budgets: { [PAINT]: 500, ready: 1000 } },
  { name: 'signed in, reload', budgets: { [PAINT]: undefined, ready: undefined, profile: 1500 } },
  {
    name: 'signed in, cache cleared',
    budgets: { [PAINT]: undefined, ready: undefined, profile: 1500 },
  },
] as const

const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: 1.6e6 / 8,
  uploadThroughput: 750e3 / 8,
}

/** Runs in the page before its own scripts: notes when each step's element first appears. */
function noteSteps(steps: Record<string, string>): void {
  const seen: Record<string, number> = {}

  window.__perchSteps = seen
  new MutationObserver(() => {
    for (const [step, selector] of Object.entries(steps)) {
      if (seen[step] === undefined && document.querySelector(selector) !== null) {
        seen[step] = performance.now()
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true })
}

/** The load's step times once the step `last` is reached, its first paint among them. */
async function stepsOf(page: Page, last: keyof typeof STEPS): Promise<Record<string, number>> {
  await page.locator(STEPS[last]).waitFor({ state: 'attached', timeout: 120_000 })

  // The paint is recorded after the frame that shows the element: wait for it, five seconds at most.
  return page.evaluate(async (paint) => {
    const painted = await new Promise<number | undefined>((resolve) => {
      const observer = new PerformanceObserver((entries) => {
        const first = entries.getEntriesByName('first-contentful-paint')[0]

        if (first !== undefined) {
          observer.disconnect()
          resolve(first.startTime)
        }
      })

      observer.observe({ type: 'paint', buffered: true })
      setTimeout(() => {
        observer.disconnect()
        resolve(undefined)
      }, 5000)
    })

    return { ...window.__perchSteps, ...(painted === undefined ? {} : { [paint]: painted }) }
  }, PAINT)
}

/** The median of the times measured, none when no run measured one. */
function median(values: readonly (number | undefined)[]): number | undefined {
  const sorted = values.filter((value) => value !== undefined).sort((a, b) => a - b)
  const middle = sorted.length / 2

  return sorted.length === 0
    ? undefined
    : Number.isInteger(middle)
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : sorted[Math.floor(middle)]
}

function options(args: readonly string[]): { runs: number; slow: boolean } {
  let runs = 5
  let slow = false

  for (const arg of args) {
    if (arg === '--slow-4g') {
      slow = true
    } else if (/^--runs=[1-9]\d*$/.test(arg)) {
      runs = Number(arg.slice('--runs='.length))
    } else {
      throw new Error(`perf-measure: unknown argument ${arg}; usage: [--runs=5] [--slow-4g]`)
    }
  }

  return { runs, slow }
}

async function main(): Promise<number> {
  const { runs, slow } = options(process.argv.slice(2))

  if (!prepareStand('perf-measure')) {
    return 1
  }

  const browser = await chromium.launch()
  const open = async () => {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      baseURL: BASE_URL,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })

    await context.addInitScript(noteSteps, STEPS)

    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)

    await cdp.send('Network.enable')

    return { context, page, cdp }
  }
  const slowDown = async (cdp: CDPSession) => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    if (slow) {
      await cdp.send('Network.emulateNetworkConditions', SLOW_4G)
    }
  }
  const [guest, warm, cold] = SCENARIOS.map(() => [] as Record<string, number>[])

  try {
    for (let run = 0; run < runs; run += 1) {
      const fresh = await open()

      await slowDown(fresh.cdp)
      await fresh.page.goto('/sign-in', { timeout: 120_000 })
      guest?.push(await stepsOf(fresh.page, 'ready'))
      await fresh.context.close()
    }

    // One account, signed up at full speed, then reloaded slowed down; its local database stays.
    const signedIn = await open()

    await signUp(signedIn.page)
    await signedIn.page.locator('html[data-sync-channel="up"]').waitFor({ state: 'attached' })
    await slowDown(signedIn.cdp)

    for (let run = 0; run < runs; run += 1) {
      await signedIn.page.reload({ timeout: 120_000 })
      warm?.push(await stepsOf(signedIn.page, 'profile'))
      await signedIn.cdp.send('Network.clearBrowserCache')
      await signedIn.page.reload({ timeout: 120_000 })
      cold?.push(await stepsOf(signedIn.page, 'profile'))
    }
  } finally {
    await browser.close()
  }

  console.log(
    `perf-measure: Pixel 7, CPU 4x slower, ${slow ? 'slow 4G' : 'local front'}, service worker blocked, median of ${runs}, in ms${slow ? ' (the budgets are for the local front)' : ''}`,
  )

  for (const [index, { name, budgets }] of SCENARIOS.entries()) {
    const loads = [guest, warm, cold][index] ?? []

    for (const [step, budget] of Object.entries(budgets)) {
      const measured = loads.map((steps) => steps[step])
      const time = median(measured)
      const count = measured.filter((value) => value !== undefined).length
      const verdict =
        time === undefined || budget === undefined || slow
          ? ''
          : `budget ${budget}, ${time <= budget ? 'within' : 'OVER'}`

      console.log(
        `  ${(step === PAINT ? name : '').padEnd(26)}${step.padEnd(13)}${(time === undefined ? 'n/a' : time.toFixed(0)).padStart(6)}   ${verdict}${count < loads.length ? ` (${count} of ${loads.length} runs measured it)` : ''}`,
      )
    }
  }

  return 0
}

process.exit(await main())
