// scenario: user/base/sign-up
import { generate } from '../../support/data'
import { appReady, expect, notice, test } from '../../support/fixtures'

test.describe('Sign up and see the profile', { tag: '@smoke' }, () => {
  test('A new user signs up and lands on the profile page', async ({ page }, testInfo) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
    }
    const onPhone = testInfo.project.name === 'mobile'

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)

      if (onPhone) {
        await expect(page).toHaveScreenshot('sign-in.png')
      }
    })

    await test.step('2. Click [user.sign-in.toggle-button]', async () => {
      await expect(page.getByTestId('user.sign-in.toggle-button')).toHaveAttribute(
        'data-value',
        'sign-up',
      )
      await page.getByTestId('user.sign-in.toggle-button').click()
    })

    await test.step('3. Enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]', async () => {
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.name-input').fill(data.name)
    })

    await test.step('4. Click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.submit-button').click()
    })

    // Expected:
    // - After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and
    //   [user.profile.heading] shows the entered name
    await expect(notice(page, 'welcome')).toBeVisible()
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
    // - [user.profile.email-input] shows the entered email
    await expect(page.getByTestId('user.profile.email-input')).toHaveValue(data.email)

    if (onPhone) {
      await expect(page).toHaveScreenshot('profile.png', {
        mask: [
          page.getByTestId('user.profile.heading'),
          page.getByTestId('user.profile.email-input'),
          page.getByTestId('user.profile.name-input'),
        ],
      })
    }

    // - Reloading the page keeps the user signed in and shows the same name
    await page.reload()
    await appReady(page)
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
  })
})
