import { test as base, expect, type Page, type TestStepInfo } from '@playwright/test'

import type { SeedAccount } from '@workspace/seed/catalog'

import { generate } from './data'

export { expect }

interface Fixtures {
  /** A user who has just signed up through the sign-in page and landed on `/me`. */
  readonly signedIn: SeedAccount
}

/** Waits until the shell says the local database is open. */
export async function appReady(page: Page): Promise<void> {
  await page.getByTestId('app-shell.ready').waitFor({ state: 'attached' })
}

let currentPage: Page | undefined

const extended = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    currentPage = page
    await use(page)
    currentPage = undefined
  },
  signedIn: async ({ page }, use) => {
    const account = { ...generate.account(), name: generate.name() }

    await page.goto('/sign-in')
    await appReady(page)
    await page.getByTestId('user.sign-in.toggle').click()
    await page.getByTestId('user.sign-in.email').fill(account.email)
    await page.getByTestId('user.sign-in.password').fill(account.password)
    await page.getByTestId('user.sign-in.name').fill(account.name)
    await page.getByTestId('user.sign-in.submit').click()
    await page.waitForURL('**/me')
    await use(account)
  },
})

const originalStep = extended.step

/** No page may scroll sideways: checked after every step, on phones and desktops. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(clientWidth)
}

extended.step = Object.assign(
  <T>(
    title: string,
    body: (info: TestStepInfo) => T | Promise<T>,
    options?: Parameters<typeof originalStep>[2],
  ): Promise<T> =>
    originalStep(
      title,
      async (info) => {
        const result = await body(info)

        if (currentPage) {
          await expectNoHorizontalOverflow(currentPage)
        }

        return result
      },
      options,
    ),
  { skip: originalStep.skip },
)

export const test = extended
