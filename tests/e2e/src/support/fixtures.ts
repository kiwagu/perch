import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
  type TestStepInfo,
} from '@playwright/test'

import type { SeedAccount } from '@workspace/seed/catalog'

import { generate } from './data'

export { expect }

/**
 * Device B: a second browser (a context of its own, so its own storage, Web Locks and
 * BroadcastChannel) for the account of `signedIn`. Nothing opens until a test asks.
 */
export interface SecondDevice {
  /** The device's page before it opens the app, for anything that must come first. */
  open(): Promise<Page>
  /** Signs the device in with the `signedIn` account through the sign-in page, on `/me`. */
  signIn(): Promise<Page>
}

/**
 * Another user: a fresh account signed up through the sign-in page in a browser of its own (a
 * context of its own, so its own storage, Web Locks and BroadcastChannel), on `/me`.
 */
export interface AnotherAccount {
  readonly account: SeedAccount
  readonly page: Page
}

interface Fixtures {
  /** A user who has just signed up through the sign-in page and landed on `/me` (device A). */
  readonly signedIn: SeedAccount
  readonly secondDevice: SecondDevice
  readonly anotherAccount: AnotherAccount
}

/** Waits until the shell says the local database is open. */
export async function appReady(page: Page): Promise<void> {
  await page.getByTestId('app-shell.ready').waitFor({ state: 'attached' })
}

/** Signs in with an existing account through the sign-in page and waits for `/me`. */
export async function signIn(page: Page, account: SeedAccount): Promise<void> {
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.email').fill(account.email)
  await page.getByTestId('user.sign-in.password').fill(account.password)
  await page.getByTestId('user.sign-in.submit').click()
  await page.waitForURL('**/me')
}

/** Signs a fresh account up through the sign-in page, waits for `/me` and returns the account. */
export async function signUp(page: Page): Promise<SeedAccount> {
  const account = { ...generate.account(), name: generate.name() }

  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.toggle').click()
  await page.getByTestId('user.sign-in.email').fill(account.email)
  await page.getByTestId('user.sign-in.password').fill(account.password)
  await page.getByTestId('user.sign-in.name').fill(account.name)
  await page.getByTestId('user.sign-in.submit').click()
  await page.waitForURL('**/me')

  return account
}

/** The browsers of the running test: the step check looks at every page they have open. */
const browsers = new Set<BrowserContext>()

const extended = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    browsers.add(page.context())
    await use(page)
    browsers.clear()
  },
  signedIn: async ({ page }, use) => {
    await use(await signUp(page))
  },
  secondDevice: async ({ browser, contextOptions, signedIn }, use) => {
    let opened: Promise<Page> | undefined
    // Playwright Test gives every context of a test the project's options (the device
    // emulated, the base URL, the front's certificate) on top of these.
    const open = (): Promise<Page> => {
      opened ??= browser.newContext(contextOptions).then((context) => {
        browsers.add(context)

        return context.newPage()
      })

      return opened
    }

    await use({
      open,
      signIn: async () => {
        const page = await open()

        await signIn(page, signedIn)

        return page
      },
    })

    if (opened) {
      const context = (await opened).context()

      browsers.delete(context)
      await context.close()
    }
  },
  anotherAccount: async ({ browser, contextOptions }, use) => {
    const context = await browser.newContext(contextOptions)

    browsers.add(context)

    try {
      const page = await context.newPage()

      await use({ account: await signUp(page), page })
    } finally {
      browsers.delete(context)
      await context.close()
    }
  },
})

const originalStep = extended.step

/** No page may scroll sideways: checked after every step, on phones and desktops. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(scrollWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(clientWidth)
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

        for (const page of [...browsers].flatMap((context) => context.pages())) {
          await expectNoHorizontalOverflow(page)
        }

        return result
      },
      options,
    ),
  { skip: originalStep.skip },
)

export const test = extended
