// scenario: user/base/unopenable-database
import { appReady, expect, test } from '../../support/fixtures'
import { databases, identityDatabase, signedInIdentity } from '../../support/storage'

test.describe('Sign out of a device whose data will not open', { tag: '@smoke' }, () => {
  test("A device that cannot open the account's data offers to sign out on it, which leaves nothing of the account behind", async ({
    page,
    signedIn: _signedIn,
  }) => {
    const database =
      await test.step('1. Open [/me] and wait for [app-shell.status] to reach [state:ready]', async () => {
        await page.goto('/me')
        await appReady(page)
        await expect(page.getByTestId('user.profile.heading')).toBeVisible()

        const name = await identityDatabase(page)

        await expect.poll(() => databases(page)).toContain(name)

        return name
      })

    await test.step("2. Leave the app for another page of the same site and break the account's local database, so that the app can no longer open it", async () => {
      // The gateway's health answer is a page of the same origin that does not run the app.
      await page.goto('/backend/health')
      // A version past the engine's own, without any of its stores.
      await page.evaluate(async (name) => {
        const found = (await indexedDB.databases()).find((each) => each.name === name)

        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name, (found?.version ?? 1) + 1)

          request.onupgradeneeded = () => {
            for (const store of Array.from(request.result.objectStoreNames)) {
              request.result.deleteObjectStore(store)
            }
          }
          request.onsuccess = () => {
            request.result.close()
            resolve()
          }
          request.onerror = () => reject(request.error)
        })
      }, database)
      // The health answer is raw JSON, wider than a phone: the page leaves it before the step ends.
      await page.goto('about:blank')
    })

    await test.step('3. Open [/me]', async () => {
      await page.goto('/me')
      // Expected: After step 3 [app-shell.status] is in [state:failed]: the page says this device
      //   could not open the data, to reload the page to try again or sign out on this device, and
      //   that changes it has not sent yet are lost; it offers [app-shell.sign-out-here-button]
      await expect(page.getByTestId('app-shell.status')).toHaveAttribute('data-state', 'failed', {
        timeout: 15_000,
      })
      await expect(page.getByTestId('app-shell.status')).toBeVisible()
      await expect(page.getByTestId('app-shell.sign-out-here-button')).toBeVisible()
    })

    await test.step('4. Click [app-shell.sign-out-here-button]', async () => {
      await page.getByTestId('app-shell.sign-out-here-button').click()
    })

    // Expected:
    // - Within 15 seconds of step 4 the page is on [/sign-in] and shows [user.sign-in.form]
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
    await expect(page.getByTestId('user.sign-in.form')).toBeVisible({ timeout: 15_000 })
    // - Within 15 seconds of step 4 the browser keeps no local database of the account and no
    //   longer names the account as signed in
    await expect.poll(() => databases(page), { timeout: 15_000 }).not.toContain(database)
    expect(await signedInIdentity(page)).toBe('')
  })
})
