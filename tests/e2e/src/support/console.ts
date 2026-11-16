/**
 * The operator console as the tests drive it: an operator appointed by the host's command, the
 * accounts of `/console/users` found by a search and paged, and an account's card opened from its
 * entry. The console's pages load on their own after the frame, so each helper waits for its
 * page's anchors, never for the address alone.
 */

import { expect, type Locator, type Page } from '@playwright/test'

import type { SeedAccount } from '@workspace/seed/catalog'

import { appReady, expectPathname, signUp } from './fixtures'
import { grantOperator } from './operators'

/** The link of the frame's navigation to the console, which a device of an operator shows. */
export const consoleLink = (page: Page): Locator =>
  page.getByTestId('app-shell.nav').getByTestId('app-shell.nav.console-link')

/**
 * Signs `account` up on `page` through the sign-in page and its mail, on `/me`; then the host's
 * command makes the account an operator, as an operator is appointed, and the page loads again: a
 * device learns its roles only from the welcome of its hello. Waits for the navigation's link to
 * the console, which shows once that welcome is in.
 */
export async function signUpOperator(page: Page, account: SeedAccount): Promise<void> {
  await signUp(page, account)
  await grantOperator(account.email)
  await page.reload()
  await appReady(page)
  await expect(consoleLink(page)).toBeVisible({ timeout: 10_000 })
}

/** Opens `/console/users` through the navigation's link and waits for the page's search box. */
export async function openUsers(page: Page): Promise<void> {
  await consoleLink(page).click()
  await expectPathname(page, '/console/users')
  await expect(page.getByTestId('console.users.search-input')).toBeVisible()
}

/** The entries of the accounts list. */
export const accountItems = (page: Page): Locator =>
  page.getByTestId('console.users.list').getByTestId('console.users.list.account-item')

/** The emails the entries of the accounts list show, in their order. */
export const listedEmails = (page: Page): Locator =>
  page.getByTestId('console.users.list').getByTestId('console.users.list.email-cell')

/** The entry of the account whose email cell shows `email`. */
export const accountItem = (page: Page, email: string): Locator =>
  accountItems(page).filter({
    has: page.getByTestId('console.users.list.email-cell').getByText(email, { exact: true }),
  })

/** Enters `text` into the search box in place of what it held, and clicks the search button. */
export async function searchAccounts(page: Page, text: string): Promise<void> {
  await page.getByTestId('console.users.search-input').fill(text)
  await page.getByTestId('console.users.search-button').click()
}

/**
 * Chooses `size` in the size select of the accounts list. The options of a select chosen in before
 * may still be on the page, hidden, so the visible one.
 */
export async function chooseSize(page: Page, size: number): Promise<void> {
  await page.getByTestId('console.users.list.size-select').click()
  await page
    .locator(`[data-testid="console.users.list.size-select.option"][data-value="${size}"]:visible`)
    .click()
}

/** The path of the page and the parameters of its search, as its address writes them. */
function addressOf(page: Page): { pathname: string; search: Record<string, string> } {
  const url = new URL(page.url())

  return { pathname: url.pathname, search: Object.fromEntries(url.searchParams) }
}

/**
 * Waits until `page` is at `pathname` with exactly the search parameters of `search`, none left
 * out and none more: a value the address leaves out is the route's default.
 */
export async function expectAddress(
  page: Page,
  pathname: string,
  search: Readonly<Record<string, string>>,
): Promise<void> {
  await expect
    .poll(() => addressOf(page), {
      message: `the address is not ${pathname} with the search expected`,
      intervals: [100],
    })
    .toEqual({ pathname, search })
}

/** Waits until the range of the accounts list says `from`-`to` of `total`, by its numbers. */
export async function expectRange(
  page: Page,
  range: { readonly from: number; readonly to: number; readonly total: number },
): Promise<void> {
  await expect(page.getByTestId('console.users.list.range')).toHaveAttribute(
    'data-from',
    String(range.from),
  )
  await expect(page.getByTestId('console.users.list.range')).toHaveAttribute(
    'data-to',
    String(range.to),
  )
  await expect(page.getByTestId('console.users.list.range')).toHaveAttribute(
    'data-total',
    String(range.total),
  )
}

/**
 * On `/console/users`, searches the account of `email` and clicks the open link of its entry once
 * the address carries the search, so no move of the search lands after the card's; waits for the
 * card, read, with that email. Answers the account's id, as its entry carries it.
 */
export async function openAccount(page: Page, email: string): Promise<string> {
  await searchAccounts(page, email)
  await expect
    .poll(() => addressOf(page).search['q'], { message: 'the address carries the search' })
    .toBe(email)

  const item = accountItem(page, email)

  await expect(item).toHaveCount(1)

  const id = await item.getAttribute('data-id')

  if (!id) {
    throw new Error('the entry of the account carries no id')
  }

  await item.getByTestId('console.users.list.open-link').click()
  await expect(page.getByTestId('console.account.section')).toHaveAttribute('data-state', 'ready')
  await expect(page.getByTestId('console.account.email-cell')).toHaveText(email)

  return id
}
