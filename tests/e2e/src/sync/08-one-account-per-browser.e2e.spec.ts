// spec: tests/e2e/specs/sync/08-one-account-per-browser.md
import { appReady, expect, signIn, test } from '../support/fixtures'
import { databases } from '../support/storage'

/** The names of the databases the browser keeps for accounts (not for their organisations). */
const accountDatabases = async (page: Parameters<typeof databases>[0]): Promise<string[]> =>
  (await databases(page)).filter((name) => /^app-identity-[^-]+$/.test(name))

test.describe('One account per browser', { tag: '@full' }, () => {
  test('A tab left on the sign-in page follows the account another tab signs in, so the browser holds one account', async ({
    page,
    signedIn,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    await test.step('1. On device A, open "/me" and wait for the app to be ready', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(signedIn.name)
    })

    await test.step('2. Click "Sign out" and wait for "/sign-in"', async () => {
      await page.getByTestId('user.profile.sign-out').click()
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
    })

    const second =
      await test.step('3. On device A, open "/sign-in" in a second tab and wait for the app to be ready', async () => {
        const tab = await page.context().newPage()

        await tab.goto('/sign-in')
        await appReady(tab)
        await expect(tab.getByTestId('user.sign-in.email')).toBeVisible()

        return tab
      })

    await test.step('4. In the first tab, sign in again with the same account and wait for "/me"', async () => {
      await signIn(page, signedIn)
    })

    // Expected:
    // - Within 5 seconds of step 4 the second tab is on "/me" and shows the account's name
    await expect(second).toHaveURL(/\/me$/, { timeout: 5_000 })
    await expect(second.getByTestId('user.profile.heading')).toHaveText(signedIn.name, {
      timeout: 5_000,
    })
    // - After step 4 the browser keeps exactly one local database of an account
    expect(await accountDatabases(page)).toHaveLength(1)
  })
})
