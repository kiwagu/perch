/**
 * What the app keeps in a page's browser: its IndexedDB databases, by the names the app gives
 * them (`app-identity-<identity>` for the signed-in identity, `app-identity-<identity>-t_<key>`
 * for each of its organisations), and the device's keys at the gateway in its localStorage.
 */

import { expect, type Page } from '@playwright/test'

/** The IndexedDB databases the page's browser keeps, by name. */
export const databases = (page: Page): Promise<string[]> =>
  page.evaluate(async () =>
    (await indexedDB.databases()).flatMap((database) => (database.name ? [database.name] : [])),
  )

/** The database the app keeps for the identity signed in on the page: `app-identity-<id>`. */
export async function identityDatabase(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const saved: unknown = JSON.parse(localStorage.getItem('perch.session.identity') ?? 'null')

    return typeof saved === 'object' && saved !== null && 'id' in saved ? String(saved.id) : ''
  })

  expect(id, 'the identity signed in on the page').not.toBe('')

  return `app-identity-${id}`
}

/** The database the app keeps on the page for organisation `key` of the identity signed in. */
export async function organisationDatabase(page: Page, key: string): Promise<string> {
  return `${await identityDatabase(page)}-t_${key}`
}
