// scenario: user/base/verified-sign-in
import { generate } from '../../support/data'
import { appReady, expect, notice, signUp, test } from '../../support/fixtures'

test.describe('Sign in with a verified email and see the profile', { tag: '@smoke' }, () => {
  test('An account whose email is verified signs in and lands on the profile page', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and wait for [/me]', async () => {
      await signUp(page, data)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
    })

    await test.step('2. Click [user.profile.sign-out-button] and wait for [/sign-in]', async () => {
      await page.getByTestId('user.profile.sign-out-button').click()
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
    })

    await test.step('3. Enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await appReady(page)
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
    })

    // Expected:
    // - After step 3 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and
    //   [user.profile.heading] shows the name the account signed up with
    await expect(notice(page, 'welcome')).toBeVisible()
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name, {
      timeout: 10_000,
    })
    // - Reloading the page keeps the account signed in and shows the same name
    await page.reload()
    await appReady(page)
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
  })
})
