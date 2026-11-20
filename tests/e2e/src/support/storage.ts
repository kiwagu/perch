/**
 * What the app keeps in a page's browser: its IndexedDB databases, by the names the app gives
 * them (`app-identity-<identity>` for the signed-in identity, `app-identity-<identity>-t_<key>`
 * for each of its organisations), and who is signed in, with the device's session token, in its
 * localStorage: the current sign-in's id under `perch.session.current`, and that sign-in's
 * record (`{ identity, email, token }`) under `perch.session.signed-in.<id>`.
 */

import { expect, type Page } from '@playwright/test'

/** The IndexedDB databases the page's browser keeps, by name. */
export const databases = (page: Page): Promise<string[]> =>
  page.evaluate(async () =>
    (await indexedDB.databases()).flatMap((database) => (database.name ? [database.name] : [])),
  )

/**
 * The identity the page's browser keeps signed in: the one the current sign-in's record names;
 * empty when nobody is signed in (no sign-in current, or its record gone after a sign-out).
 */
export const signedInIdentity = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const current = localStorage.getItem('perch.session.current')
    const record: unknown = JSON.parse(
      current === null
        ? 'null'
        : (localStorage.getItem(`perch.session.signed-in.${current}`) ?? 'null'),
    )

    return typeof record === 'object' && record !== null && 'identity' in record
      ? String(record.identity)
      : ''
  })

/** The database the app keeps for the identity signed in on the page: `app-identity-<id>`. */
export async function identityDatabase(page: Page): Promise<string> {
  const id = await signedInIdentity(page)

  expect(id, 'the identity signed in on the page').not.toBe('')

  return `app-identity-${id}`
}

/** The database the app keeps on the page for organisation `key` of the identity signed in. */
export async function organisationDatabase(page: Page, key: string): Promise<string> {
  return `${await identityDatabase(page)}-t_${key}`
}
