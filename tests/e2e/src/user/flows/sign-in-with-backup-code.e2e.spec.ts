// scenario: user/flows/sign-in-with-backup-code

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { generate } from '../../support/data'
import { expect, expectPathname, notice, signOut, signUp, test } from '../../support/fixtures'
import { submitCode, submitCredentials, turnSecondFactorOn } from '../../support/second-factor'

test.describe('Sign in with a backup code of the second factor', { tag: '@full' }, () => {
  test('A backup code takes the place of a code of the app once, and is used up by it', async ({
    page,
  }) => {
    // Two sign-outs wait for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
    })

    const shown =
      await test.step('2. Enter the password into [user.settings.two-factor.password-input], click [user.settings.two-factor.enable-button], enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input] and click [user.settings.two-factor.confirm-button]', async () => {
        const on = await turnSecondFactorOn(page, data.password)

        return on.codes
      })

    const [first, second] =
      await test.step('3. Keep the first two backup codes [user.settings.two-factor.codes-cell] shows, click [user.settings.two-factor.hide-codes-button], click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]', async () => {
        const kept = shown.slice(0, 2)

        await page.getByTestId('user.settings.two-factor.hide-codes-button').click()
        await page.getByTestId('app-shell.nav.profile-link').click()
        await expectPathname(page, CONTRACT_ROUTES['user.profile'])
        await signOut(page)

        return kept
      })

    if (first === undefined || second === undefined) {
      throw new Error('the settings showed fewer than two backup codes')
    }

    await test.step('4. Enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button], enter the first backup code step 3 kept into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]', async () => {
      await submitCredentials(page, data)
      await submitCode(page, first)
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
    })

    await test.step('5. Click [user.profile.sign-out-button], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button], enter that first backup code again into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]', async () => {
      await signOut(page)
      await submitCredentials(page, data)
      await submitCode(page, first)
      // Expected: After step 5 [user.sign-in.code.error] carries [code:invalid-code] and the URL
      //   is still [/sign-in]: the backup code was used up
      await expect(page.getByTestId('user.sign-in.code.error')).toHaveAttribute(
        'data-code',
        'invalid-code',
      )
      await expectPathname(page, CONTRACT_ROUTES['user.sign-in'])
    })

    await test.step('6. Enter the second backup code step 3 kept into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]', async () => {
      await submitCode(page, second)
      // Expected: After step 6 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
    })
  })
})
