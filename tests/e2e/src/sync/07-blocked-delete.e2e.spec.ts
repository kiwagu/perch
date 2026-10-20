// spec: tests/e2e/specs/sync/07-blocked-delete.md
import { appReady, expect, test } from '../support/fixtures'
import { databases, identityDatabase } from '../support/storage'

test.describe('Sign out while another tab holds the data open', { tag: '@full' }, () => {
  test('A sign-out ends even though another tab holds the data open, says so, and the data goes once that tab closes', async ({
    page,
    signedIn: _signedIn,
  }) => {
    // The sign-out waits a few seconds for the delete before it ends without it.
    test.slow()

    const database =
      await test.step('1. On device A, open "/me" in a first tab and wait for the app to be ready', async () => {
        await page.goto('/me')
        await appReady(page)
        await expect(page.getByTestId('user.profile.heading')).toBeVisible()

        const name = await identityDatabase(page)

        await expect.poll(() => databases(page)).toContain(name)

        return name
      })

    const holder =
      await test.step("2. On device A, open a second tab that holds the account's local database open and never lets it go, as a frozen tab would", async () => {
        const second = await page.context().newPage()

        await second.goto('/me')
        await appReady(second)
        // A connection of its own, deaf to the browser asking it to close for a delete.
        await second.evaluate(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.open(name)

              request.onsuccess = () => {
                Reflect.set(window, '__heldDatabase', request.result)
                resolve()
              }
              request.onerror = () => reject(request.error)
            }),
          database,
        )

        return second
      })

    await test.step('3. In the first tab, click "Sign out"', async () => {
      await page.getByTestId('user.profile.sign-out').click()
      // Expected: within 15 seconds of step 3 the first tab is on "/sign-in" and says that the
      // data leaves the device once the other tabs are closed
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
      await expect(page.getByTestId('user.sign-in.notice.delete-pending')).toHaveText(
        'You are signed out. Your data leaves this device once the other Perch tabs are closed.',
      )
      // Expected: after step 3 the browser still keeps the account's local database
      expect(await databases(page)).toContain(database)
    })

    await test.step('4. Close the second tab', async () => {
      await holder.close()
    })

    // Expected:
    // - Within 10 seconds of step 4 the browser keeps no local database of the account
    await expect.poll(() => databases(page), { timeout: 10_000 }).not.toContain(database)
  })
})
