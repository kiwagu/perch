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
import { openDeclaredMail } from './mail-contract'
import { type SecurityWatch, watchSecurity } from './security'

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

interface Fixtures {
  /**
   * A user who has just signed up through the sign-in page, opened the link of the verification
   * mail and landed on `/me` (device A).
   */
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

/** A fresh account to sign up with, under a name of its own. */
const freshAccount = (): SeedAccount => ({ ...generate.account(), name: generate.name() })

/**
 * Opens the sign-in page, switches it to sign-up and submits `account`; waits until the page asks
 * to check the mail, the sign-up's mail on its way and nothing signed in.
 */
export async function startSignUp(page: Page, account: SeedAccount): Promise<void> {
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.toggle-button').click()
  await page.getByTestId('user.sign-in.email-input').fill(account.email)
  await page.getByTestId('user.sign-in.password-input').fill(account.password)
  await page.getByTestId('user.sign-in.name-input').fill(account.name)
  await page.getByTestId('user.sign-in.submit-button').click()
  await expect(checkYourMail(page)).toBeVisible()
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

/** The front every stand serves the app from, the origin the security check holds to its headers. */
function frontOf(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('the e2e projects give every browser the base URL of the front')
  }

  return new URL(baseURL).origin
}

/** Fails the test with every problem a browser reported against the front's security policy. */
function expectSecure(problems: readonly string[]): void {
  expect(
    problems,
    'the front sends its security headers and no page or worker breaks its policy',
  ).toEqual([])
}

/**
 * A browser context of the test's own, opened on first use and watched by the security check
 * from before its first page; `close` closes it if it opened, then fails the test with the
 * problems it reported until then.
 */
function ownBrowser(
  browser: Browser,
  options: BrowserContextOptions,
  front: string,
): { open(): Promise<Page>; close(): Promise<void> } {
  let opened: Promise<{ page: Page; security: SecurityWatch }> | undefined

  return {
    open: async () => {
      opened ??= browser.newContext(options).then(async (context) => {
        browsers.add(context)
        const security = await watchSecurity(context, front)

        return { page: await context.newPage(), security }
      })

      return (await opened).page
    },
    close: async () => {
      if (opened) {
        const { page, security } = await opened
        const context = page.context()
        const problems = security.problems()

        browsers.delete(context)
        await context.close()
        expectSecure(problems)
      }
    },
  }
}

const extended = base.extend<Fixtures>({
  page: async ({ page, baseURL }, use) => {
    const security = await watchSecurity(page.context(), frontOf(baseURL))

    browsers.add(page.context())
    await use(page)
    browsers.clear()
    expectSecure(security.problems())
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
