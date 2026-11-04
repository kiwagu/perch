import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  expect,
  type Page,
} from '@playwright/test'

import { watchSecurity } from './security'
import { watchSettled } from './settled'

/** The browsers of the running test: the step check looks at every page they have open. */
export const browsers = new Set<BrowserContext>()

/** The front every stand serves the app from, the origin the security check holds to its headers. */
export function frontOf(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('the e2e projects give every browser the base URL of the front')
  }

  return new URL(baseURL).origin
}

/** What a browser of a test reported until now, each problem once. */
export interface WatchedProblems {
  /** Against the front's security policy. */
  readonly security: readonly string[]
  /** Against what the state of a screen renders, in each state its pages settled in. */
  readonly settled: readonly string[]
}

/** A browser context watched from before its first page, for the test to check at its end. */
export interface BrowserWatch {
  problems(): Promise<WatchedProblems>
}

/** Watches `context` against the front's security policy and the contract's settled states. */
export async function watchBrowser(context: BrowserContext, front: string): Promise<BrowserWatch> {
  const security = await watchSecurity(context, front)
  const settled = await watchSettled(context)

  return {
    problems: async () => ({ security: security.problems(), settled: await settled.problems() }),
  }
}

/** Fails the test with every problem a browser reported. */
export function expectWatched(problems: WatchedProblems): void {
  expect(
    problems.security,
    'the front sends its security headers and no page or worker breaks its policy',
  ).toEqual([])
  expect(
    problems.settled,
    'every page shows what the state of its screen renders, in each state it settled in',
  ).toEqual([])
}

/**
 * A browser context of the test's own, opened on first use and watched from before its first
 * page; `close` closes it if it opened, then fails the test with the problems it reported until
 * then.
 */
export function ownBrowser(
  browser: Browser,
  options: BrowserContextOptions,
  front: string,
): { open(): Promise<Page>; close(): Promise<void> } {
  let opened: Promise<{ page: Page; watch: BrowserWatch }> | undefined

  return {
    open: async () => {
      opened ??= browser.newContext(options).then(async (context) => {
        browsers.add(context)
        const watch = await watchBrowser(context, front)

        return { page: await context.newPage(), watch }
      })

      return (await opened).page
    },
    close: async () => {
      if (opened) {
        const { page, watch } = await opened
        const context = page.context()
        const problems = await watch.problems()

        browsers.delete(context)
        await context.close()
        expectWatched(problems)
      }
    },
  }
}
