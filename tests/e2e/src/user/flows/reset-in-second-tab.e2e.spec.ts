// scenario: user/flows/reset-in-second-tab
import { generate } from '../../support/data'
import {
  appReady,
  expect,
  expectPathname,
  notice,
  signInNotice,
  signOut,
  signUp,
  test,
} from '../../support/fixtures'
import {
  askForReset,
  enterNewPassword,
  openResetMail,
  resetRequested,
} from '../../support/password-reset'

test.describe('Set a new password in a second tab while the first waits for the mail', {
  tag: '@full',
}, () => {
  test('The tab that asked for the mail follows a new password set in another tab: it moves to the sign-in page with the email and says why', async ({
    page,
  }) => {
    // A sign-out and the sign-in after it wait for the sync channel.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await signOut(page)
    })

    await test.step('2. In a first tab, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
      await askForReset(page, data.email)
      // Expected: After step 2 [user.forgot-password.message] carries [code:check-your-mail]
      await expect(resetRequested(page)).toBeVisible()
    })

    await test.step('3. In a second tab, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      const second = await page.context().newPage()

      await openResetMail(second, data.email, 1)
      await appReady(second)

      // Expected: Within 5 seconds of step 3 the first tab is on [/sign-in],
      //   [user.sign-in.email-input] holds the email and [user.sign-in.notice-message] carries
      //   [code:password-reset-elsewhere]
      // The three start as the gateway answers the reset, so one 5-second timeout is one
      // deadline counted from that answer, whatever the second tab still waits for.
      const followed = second
        .waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname.endsWith('/auth/reset-password'),
        )
        .then(() =>
          Promise.all([
            expectPathname(page, '/sign-in', 5_000),
            expect(page.getByTestId('user.sign-in.email-input')).toHaveValue(data.email, {
              timeout: 5_000,
            }),
            expect(signInNotice(page, 'password-reset-elsewhere')).toBeVisible({ timeout: 5_000 }),
          ]),
        )

      await Promise.all([
        followed,
        enterNewPassword(second, data.newPassword).then(() =>
          // Expected: After step 3 the second tab's [user.reset-password.message] carries
          //   [code:password-reset]
          expect(second.getByTestId('user.reset-password.message')).toHaveAttribute(
            'data-code',
            'password-reset',
          ),
        ),
      ])
    })

    await test.step('4. In the first tab, enter the new password into [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.password-input').fill(data.newPassword)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, '/me')
    })
  })
})
