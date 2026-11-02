// scenario: user/base/password-visibility
import { generate } from '../../support/data'
import { appReady, expect, test } from '../../support/fixtures'

test.describe('Show the password as it is typed', { tag: '@smoke' }, () => {
  test('The eye beside a password shows what was typed and hides it again', async ({ page }) => {
    const data = {
      password: generate.password(),
    }
    const password = page.getByTestId('user.sign-in.password-input')
    const eye = page.getByTestId('user.sign-in.password-input.visibility-button')

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
    })

    await test.step('2. Enter the password into [user.sign-in.password-input]', async () => {
      await password.fill(data.password)
      // Expected: After step 2 [user.sign-in.password-input.visibility-button] carries
      //   [value:show] and [user.sign-in.password-input] hides what it holds
      await expect(eye).toHaveAttribute('data-value', 'show')
      await expect(password).toHaveAttribute('type', 'password')
      await expect(eye).toBeEnabled()
    })

    await test.step('3. Click [user.sign-in.password-input.visibility-button]', async () => {
      await eye.click()
      // Expected: After step 3 [user.sign-in.password-input.visibility-button] carries
      //   [value:hide] and [user.sign-in.password-input] shows the password as typed
      await expect(eye).toHaveAttribute('data-value', 'hide')
      await expect(password).toHaveAttribute('type', 'text')
      await expect(password).toHaveValue(data.password)
      await expect(eye).toBeEnabled()
    })

    await test.step('4. Click [user.sign-in.password-input.visibility-button]', async () => {
      await eye.click()
      // Expected: After step 4 [user.sign-in.password-input.visibility-button] carries
      //   [value:show] again
      await expect(eye).toHaveAttribute('data-value', 'show')
      await expect(password).toHaveAttribute('type', 'password')
      await expect(password).toHaveValue(data.password)
    })
  })
})
