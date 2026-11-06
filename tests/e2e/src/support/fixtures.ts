import { test as base, expect, type Page, type TestStepInfo } from '@playwright/test'

import type { SeedAccount } from '@workspace/seed/catalog'

import { browsers, expectWatched, frontOf, ownBrowser, watchBrowser } from './browsers'
import { CLIENT_ADDRESS_HEADER, clientAddressOf } from './client-address'
import { generate } from './data'
import { openDeclaredMail } from './mail-contract'

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
  /** Signs the account up through the sign-in page and its mail in that browser, on `/me`. */
  signUp(): Promise<Page>
}

/**
 * Another device for an account the test makes itself: a browser of its own (a context of its
 * own, so its own storage, Web Locks and BroadcastChannel) that opens nothing until a test asks
 * and signs nothing in by itself.
 */
export interface FreshDevice {
  /** The device's page, on no address yet. */
  open(): Promise<Page>
}

interface Fixtures {
  /**
   * A user who has just signed up through the sign-in page, opened the link of the verification
   * mail and landed on `/me` (device A).
   */
  readonly signedIn: SeedAccount
  readonly secondDevice: SecondDevice
  readonly anotherAccount: AnotherAccount
  readonly freshDevice: FreshDevice
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
 * Waits up to `timeout` until `page` is on `pathname`, reading its path alone: a page opened from a
 * mail's link carries the link's token in its search, which a failure must not print.
 */
export async function expectPathname(
  page: Page,
  pathname: string,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: `the page is not on ${pathname}`,
      timeout,
      intervals: [100],
    })
    .toBe(pathname)
}

/** The sign-in page asking to open the link of the verification mail, by anchor and code. */
export const checkYourMail = (page: Page) =>
  page.locator('[data-testid="user.sign-in.mail-message"][data-code="check-your-mail"]')

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

/**
 * Clicks the profile's sign-out button and waits up to 15 s for the sign-in page: a sign-out waits
 * for the sync channel first.
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByTestId('user.profile.sign-out-button').click()
  await expectPathname(page, '/sign-in', 15_000)
}

/** A fresh account to sign up with, under a name of its own. */
const freshAccount = (): SeedAccount => ({ ...generate.account(), name: generate.name() })

/**
 * Opens the sign-in page, switches it to sign-up and submits `account`, its password typed twice;
 * waits until the page asks to check the mail, the sign-up's mail on its way and nothing signed in.
 * The gateway answers a sign-up no sooner than its floor (800 ms), by when an assertion looks only
 * every 500 ms, so the page is read every 50 ms instead: the message is seen as it shows.
 */
export async function startSignUp(page: Page, account: SeedAccount): Promise<void> {
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.toggle-button').click()
  await page.getByTestId('user.sign-in.email-input').fill(account.email)
  await page.getByTestId('user.sign-in.password-input').fill(account.password)
  await page.getByTestId('user.sign-in.password-confirmation-input').fill(account.password)
  await page.getByTestId('user.sign-in.name-input').fill(account.name)
  await page.getByTestId('user.sign-in.submit-button').click()
  await expect
    .poll(() => checkYourMail(page).isVisible(), {
      message: 'the sign-in page asks to check the mail',
      intervals: [50],
    })
    .toBe(true)
}

/**
 * Signs `account` (a fresh one by default) up through the sign-in page in the app's language
 * `locale` (the browser's, `en`, unless the test chose another), then opens the link of the mail
 * the sign-up declares, held to its declaration, in the same page, which signs it in; returns it
 * on `/me`.
 */
export async function signUp(
  page: Page,
  account = freshAccount(),
  locale = 'en',
): Promise<SeedAccount> {
  await startSignUp(page, account)
  await openDeclaredMail(page, 'sign-up', { params: { email: account.email, locale } })
  await expectPathname(page, '/me')

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

const extended = base.extend<Fixtures>({
  // Every browser of a test, its own contexts included (Playwright Test gives them the test's
  // options), claims its worker's client address at the front (`client-address.ts`).
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    await use({
      ...extraHTTPHeaders,
      [CLIENT_ADDRESS_HEADER]: clientAddressOf(testInfo.parallelIndex),
    })
  },
  // Every browser of a test is watched from before its first page: the front's security policy,
  // and what each page shows in each state of its screen it settled in (`browsers.ts`).
  page: async ({ page, baseURL }, use) => {
    const watch = await watchBrowser(page.context(), frontOf(baseURL))

    browsers.add(page.context())
    await use(page)
    browsers.clear()
    expectWatched(await watch.problems())
  },
  signedIn: async ({ page }, use) => {
    await use(await signUp(page))
  },
  // Playwright Test gives every context of a test the project's options (the device emulated,
  // the base URL, the front's certificate) on top of `contextOptions`.
  secondDevice: async ({ browser, contextOptions, baseURL, signedIn }, use) => {
    const device = ownBrowser(browser, contextOptions, frontOf(baseURL))

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
  anotherAccount: async ({ browser, contextOptions, baseURL }, use) => {
    const account = freshAccount()
    const device = ownBrowser(browser, contextOptions, frontOf(baseURL))

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
  freshDevice: async ({ browser, contextOptions, baseURL }, use) => {
    const device = ownBrowser(browser, contextOptions, frontOf(baseURL))

    await use({ open: device.open })
    await device.close()
  },
})

const originalStep = extended.step

/** A read of a page that a navigation interrupted: the document it read went with it. */
const navigatedAway = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('Execution context was destroyed')

/**
 * How wide a page is and how wide it shows. A step's last action may start a navigation (a
 * sign-out moves to /sign-in), which can replace the document while it is read: the new one is
 * measured once it has loaded, up to three times; any other failure fails at once.
 */
async function pageWidths(
  page: Page,
  attempt = 1,
): Promise<{ readonly scrollWidth: number; readonly clientWidth: number }> {
  try {
    return await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
  } catch (error: unknown) {
    if (!navigatedAway(error) || attempt === 3) {
      throw error
    }

    await page.waitForLoadState('load')

    return pageWidths(page, attempt + 1)
  }
}

/** No page may scroll sideways: checked after every step, on phones and desktops. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await pageWidths(page)

  // The path alone: a page opened from a mail's link carries its token in the search.
  expect(scrollWidth, `${new URL(page.url()).pathname} scrolls sideways`).toBeLessThanOrEqual(
    clientWidth,
  )
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
