// scenario: user/flows/confirm-email-other-account
import { generate } from '../../support/data'
import { askToChangeEmail, openChangeEmailMail } from '../../support/email-change'
import { appReady, expect, expectPathname, signUp, test } from '../../support/fixtures'

test.describe('Open an email confirmation link in a browser signed in to another account', {
  tag: '@full',
}, () => {
  test('The link changes the email whichever account this browser holds; with another account signed in, the page offers no link that would not work', async ({
    page,
    anotherAccount,
  }) => {
    // Two sign-ups each wait for the sync channel to come up.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newEmail: generate.newEmail(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up], open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]', async () => {
      await signUp(page, data)
      await page.goto('/settings')
      await appReady(page)
      await askToChangeEmail(page, data.newEmail, data.password)
    })

    // The other email, password and name are the other account's own (`anotherAccount`).
    const deviceB =
      await test.step('2. On device B, sign up with the other email, the other password and the other name, open the link of [mail:sign-up] and wait for [/me]', async () => {
        const b = await anotherAccount.signUp()

        await expect(b.getByTestId('user.profile.heading')).toHaveText(anotherAccount.account.name)

        return b
      })

    await test.step('3. On device B, open the link of [mail:change-email]', async () => {
      await openChangeEmailMail(deviceB, data)
      // Expected: After step 3 [user.confirm-email.message] carries [code:email-changed] on
      //   device B, and neither [user.confirm-email.sign-in-link] nor
      //   [user.confirm-email.profile-link] shows
      await expect(deviceB.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
      await expect(deviceB.getByTestId('user.confirm-email.sign-in-link')).toHaveCount(0)
      await expect(deviceB.getByTestId('user.confirm-email.profile-link')).toHaveCount(0)
    })

    // Expected: [user.profile.email-input] on device A holds the new email. Device A is still on
    // /settings after step 1: its profile is read through its navigation.
    await page.getByTestId('app-shell.nav.profile-link').click()
    await expectPathname(page, '/me')
    await expect(page.getByTestId('user.profile.email-input')).toHaveValue(data.newEmail, {
      timeout: 10_000,
    })
  })
})
