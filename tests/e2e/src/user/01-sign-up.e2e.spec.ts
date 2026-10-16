// spec: tests/e2e/specs/user/01-sign-up.md
import { generate } from '../support/data'
import { appReady, expect, test } from '../support/fixtures'

test.describe('Sign up and see the profile', { tag: '@smoke' }, () => {
  test('A new user signs up and lands on the profile page', async ({ page }, testInfo) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
    }
    const onPhone = testInfo.project.name === 'mobile'

    await test.step('1. Open "/sign-in" and wait for the app to be ready', async () => {
      await page.goto('/sign-in')
      await appReady(page)

      if (onPhone) {
        await expect(page).toHaveScreenshot('sign-in.png')
      }
    })

    await test.step('2. Click "Create account"', async () => {
      await page.getByRole('button', { name: 'Create account' }).click()
    })

    await test.step('3. Enter email, password and name', async () => {
      await page.getByTestId('user.sign-in.email').fill(data.email)
      await page.getByTestId('user.sign-in.password').fill(data.password)
      await page.getByTestId('user.sign-in.name').fill(data.name)
    })

    await test.step('4. Click "Sign up"', async () => {
      await page.getByRole('button', { name: 'Sign up' }).click()
    })

    // Expected:
    // - After step 4 the page shows the notification "Welcome", the URL is "/me", the heading shows the entered name
    await expect(page.getByTestId('user.sign-in.notice')).toHaveText('Welcome')
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
    // - The profile email field shows the entered email
    await expect(page.getByTestId('user.profile.email')).toHaveValue(data.email)

    if (onPhone) {
      await expect(page).toHaveScreenshot('profile.png', {
        mask: [
          page.getByTestId('user.profile.heading'),
          page.getByTestId('user.profile.email'),
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
