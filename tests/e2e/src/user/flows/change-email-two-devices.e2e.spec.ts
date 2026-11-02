// scenario: user/flows/change-email-two-devices
import { generate } from '../../support/data'
import { askToChangeEmail, openChangeEmailMail } from '../../support/email-change'
import {
  appReady,
  expect,
  expectPathname,
  notice,
  signIn,
  signOut,
  signUp,
  test,
} from '../../support/fixtures'

test.describe('Change the email while another device is signed in', { tag: '@full' }, () => {
  test("The new email reaches the account's other device, and the old email no longer signs in", async ({
    page,
    freshDevice,
  }) => {
    // Two sign-ins each wait for the sync channel, and a sign-out waits for it first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newEmail: generate.newEmail(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
    })

    const deviceB =
      await test.step('2. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [/me]', async () => {
        const b = await freshDevice.open()

        await signIn(b, data)
        await expect(b.getByTestId('user.profile.email-input')).toHaveValue(data.email, {
          timeout: 10_000,
        })

        return b
      })

    await test.step('3. On device A, open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], click [user.settings.email.send-button], and open the link of [mail:change-email]', async () => {
      await page.goto('/settings')
      await appReady(page)
      await askToChangeEmail(page, data.newEmail, data.password)
      await openChangeEmailMail(page, data)
      await expect(page.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
      // Expected: After step 3 [user.profile.email-input] on device B holds the new email
      await expect(deviceB.getByTestId('user.profile.email-input')).toHaveValue(data.newEmail, {
        timeout: 10_000,
      })
    })

    await test.step('4. On device B, click [user.profile.sign-out-button], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      await signOut(deviceB)
      await deviceB.getByTestId('user.sign-in.email-input').fill(data.email)
      await deviceB.getByTestId('user.sign-in.password-input').fill(data.password)
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 4 [user.sign-in.error] carries [code:invalid-credentials] on device B
      await expect(deviceB.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'invalid-credentials',
      )
    })

    await test.step('5. On device B, enter the new email into [user.sign-in.email-input] and click [user.sign-in.submit-button]', async () => {
      await deviceB.getByTestId('user.sign-in.email-input').fill(data.newEmail)
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 5 [app-shell.notice-message] carries [code:welcome] on device B and
      //   its URL is [/me]
      await expect(notice(deviceB, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(deviceB, '/me')
    })
  })
})
