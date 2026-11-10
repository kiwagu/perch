// scenario: app-shell/base/toast-before-data
import { generate } from '../../support/data'
import { holdEngines } from '../../support/engines'
import { expect, expectPathname, signUp, test, toast } from '../../support/fixtures'

test.describe('See a toast before the data opens', { tag: '@smoke' }, () => {
  test("A password changed while the account's data opens says so at once, before the data is open", async ({
    page,
  }) => {
    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }
    const status = page.getByTestId('app-shell.status')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step("2. Hold back the page's database engines, so that the account's data cannot open yet", () =>
      holdEngines(page.context()))

    await test.step('3. Reload the page', async () => {
      await page.reload({ waitUntil: 'commit' })
      // Expected: After step 3 [app-shell.status] reaches [state:opening-data] on [/settings]
      await expect(status).toHaveAttribute('data-state', 'opening-data')
      await expectPathname(page, '/settings')
    })

    await test.step('4. Enter the password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]', async () => {
      await page.getByTestId('user.settings.password.current-password-input').fill(data.password)
      await page.getByTestId('user.settings.password.new-password-input').fill(data.newPassword)
      await page
        .getByTestId('user.settings.password.password-confirmation-input')
        .fill(data.newPassword)
      await page.getByTestId('user.settings.password.save-button').click()
      // Expected: After step 4 [app-shell.toast] carries [code:password-changed] while
      //   [app-shell.status] is still in [state:opening-data]
      await expect(toast(page, 'password-changed')).toBeVisible()
      await expect(status).toHaveAttribute('data-state', 'opening-data')
    })
  })
})
