// scenario: not-found/base/unknown-address
import { appReady, expect, signUp, test } from '../../support/fixtures'

test.describe('Open an address no page has', { tag: '@smoke' }, () => {
  test('A guest and then a signed-in account open an address no page has, and each gets its own way back', async ({
    page,
  }) => {
    const data = {
      unknownAddress: '/no-such-page',
    }

    await test.step('1. Open the unknown address and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto(data.unknownAddress)
      await appReady(page)
      // Expected: After step 1 the address is still the unknown address and
      //   [not-found.page.heading] shows, with [not-found.page.sign-in-link] and no
      //   [not-found.page.profile-link]
      await expect(page).toHaveURL(new RegExp(`${data.unknownAddress}$`))
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expect(page.getByTestId('not-found.page.sign-in-link')).toBeVisible()
      await expect(page.getByTestId('not-found.page.profile-link')).toHaveCount(0)
    })

    await test.step('2. Click [not-found.page.sign-in-link]', async () => {
      await page.getByTestId('not-found.page.sign-in-link').click()
      // Expected: After step 2 the URL is [/sign-in]
      await expect(page).toHaveURL(/\/sign-in$/)
    })

    await test.step('3. Sign up and wait for [/me], then open the unknown address again', async () => {
      await signUp(page)
      await page.goto(data.unknownAddress)
      await appReady(page)
      // Expected: After step 3 [not-found.page.heading] shows, with [not-found.page.profile-link]
      //   and no [not-found.page.sign-in-link]
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expect(page.getByTestId('not-found.page.profile-link')).toBeVisible()
      await expect(page.getByTestId('not-found.page.sign-in-link')).toHaveCount(0)
    })

    await test.step('4. Click [not-found.page.profile-link]', async () => {
      await page.getByTestId('not-found.page.profile-link').click()
      // Expected: After step 4 the URL is [/me]
      await expect(page).toHaveURL(/\/me$/)
    })
  })
})
