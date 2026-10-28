import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
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
 * Another user: a fresh account and a browser of its own (a context of its own, so its own
 * storage, Web Locks and BroadcastChannel). Nothing opens until a test asks.
 */
export interface AnotherAccount {
  /** The account the user signs up with. */
  readonly account: SeedAccount
  /** The browser's page before it opens the app, for anything that must come first. */
  open(): Promise<Page>
  /** Signs the account up through the sign-in page in that browser, on `/me`. */
  signUp(): Promise<Page>
}

interface Fixtures {
  /** A user who has just signed up through the sign-in page and landed on `/me` (device A). */
  readonly signedIn: SeedAccount
  readonly secondDevice: SecondDevice
  readonly anotherAccount: AnotherAccount
}

/** The shell's status line once it says the app is ready: the frame and the screen are rendered. */
export const APP_READY = '[data-testid="app-shell.status"][data-state="ready"]'

/** Waits until the shell says the app is ready (the local database is open). */
export async function appReady(page: Page): Promise<void> {
  await page.locator(APP_READY).waitFor({ state: 'attached' })
}

/** The shell's notice, located by its anchor and its contract code together. */
export const notice = (page: Page, code: string) =>
  page.locator(`[data-testid="app-shell.notice-message"][data-code="${code}"]`)

/** One toast of the frame, located by its anchor and its contract code together. */
export const toast = (page: Page, code: string) =>
  page.locator(`[data-testid="app-shell.toast"][data-code="${code}"]`)

/** The sign-in page's word on how the last session ended, by its anchor and its code. */
export const signInNotice = (page: Page, code: string) =>
  page.locator(`[data-testid="user.sign-in.notice-message"][data-code="${code}"]`)

/**
 * Signs in with an existing account through the sign-in page and waits for `/me`; fails at once
 * when the page shows its error instead.
 */
export async function signIn(page: Page, account: SeedAccount): Promise<void> {
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.email-input').fill(account.email)
  await page.getByTestId('user.sign-in.password-input').fill(account.password)
  await page.getByTestId('user.sign-in.submit-button').click()

  const outcome = await page.waitForFunction(
    () =>
      window.location.pathname === '/me' ||
      document.querySelector('[data-testid="user.sign-in.error"]')?.getAttribute('data-code'),
  )

  expect(await outcome.jsonValue(), 'the sign-in page answered with its error code').toBe(true)
  await page.waitForURL('**/me')
}

/** A fresh account to sign up with, under a name of its own. */
const freshAccount = (): SeedAccount => ({ ...generate.account(), name: generate.name() })

/** Signs `account` (a fresh one by default) up through the sign-in page; returns it on `/me`. */
export async function signUp(page: Page, account = freshAccount()): Promise<SeedAccount> {
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.toggle-button').click()
  await page.getByTestId('user.sign-in.email-input').fill(account.email)
  await page.getByTestId('user.sign-in.password-input').fill(account.password)
  await page.getByTestId('user.sign-in.name-input').fill(account.name)
  await page.getByTestId('user.sign-in.submit-button').click()
  await page.waitForURL('**/me')

  return account
}

/**
 * Counts the page's full loads from now on (a reload, or a navigation that loads the app again;
 * a move between the app's pages is none), for checks that something arrived without one.
 */
export function pageLoads(page: Page): () => number {
  let loads = 0

  page.on('load', () => {
    loads += 1
  })

  return () => loads
}

/** The browsers of the running test: the step check looks at every page they have open. */
const browsers = new Set<BrowserContext>()

/** A browser context of the test's own, opened on first use; `close` closes it if it opened. */
function ownBrowser(
  browser: Browser,
  options: BrowserContextOptions,
): { open(): Promise<Page>; close(): Promise<void> } {
  let opened: Promise<Page> | undefined

  return {
    open: () => {
      opened ??= browser.newContext(options).then((context) => {
        browsers.add(context)

        return context.newPage()
      })

      return opened
    },
    close: async () => {
      if (opened) {
        const context = (await opened).context()

        browsers.delete(context)
        await context.close()
      }
    },
  }
}

const extended = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    browsers.add(page.context())
    await use(page)
    browsers.clear()
  },
  signedIn: async ({ page }, use) => {
    await use(await signUp(page))
  },
  // Playwright Test gives every context of a test the project's options (the device emulated,
  // the base URL, the front's certificate) on top of `contextOptions`.
  secondDevice: async ({ browser, contextOptions, signedIn }, use) => {
    const device = ownBrowser(browser, contextOptions)

    await use({
      open: device.open,
      signIn: async () => {
        const page = await device.open()

        await signIn(page, signedIn)

        return page
      },
    })
    await device.close()
  },
  anotherAccount: async ({ browser, contextOptions }, use) => {
    const account = freshAccount()
    const device = ownBrowser(browser, contextOptions)

    await use({
      account,
      open: device.open,
      signUp: async () => {
        const page = await device.open()

        await signUp(page, account)

        return page
      },
    })
    await device.close()
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
