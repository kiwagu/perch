// scenario: user/flows/sign-in-with-code

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { generate } from '../../support/data'
import { expect, expectPathname, notice, signOut, signUp, test } from '../../support/fixtures'
import {
  codeDialog,
  submitCode,
  submitCredentials,
  turnSecondFactorOn,
} from '../../support/second-factor'
import { totpFor, wrongCodeFor } from '../../support/totp'

test.describe('Sign in with a code of the second factor', { tag: '@smoke' }, () => {
  test('The right password of an account whose second factor is on asks for a code and signs nothing in until a code of its key is taken; going back starts again from the password', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }
    const dialog = codeDialog(page)
    const error = page.getByTestId('user.sign-in.code.error')
    const codeInput = page.getByTestId('user.sign-in.code.code-input')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
    })

    const { key } =
      await test.step('2. Enter the password into [user.settings.two-factor.password-input], click [user.settings.two-factor.enable-button], enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input], click [user.settings.two-factor.confirm-button] and click [user.settings.two-factor.hide-codes-button]', async () => {
        const on = await turnSecondFactorOn(page, data.password)

        await page.getByTestId('user.settings.two-factor.hide-codes-button').click()

        return on
      })

    await test.step('3. Click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
      await signOut(page)
    })

    await test.step('4. Enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await submitCredentials(page, data)
      // Expected: After step 4 [user.sign-in.code.dialog] carries [code:code-required] and the
      //   URL is still [screen:user.sign-in]: nothing is signed in yet
      await expect(dialog).toHaveAttribute('data-code', 'code-required')
      await expectPathname(page, CONTRACT_ROUTES['user.sign-in'])
      await expect(page.getByTestId('app-shell.nav')).toHaveCount(0)
    })

    await test.step('5. Click [user.sign-in.code.dialog.cancel-button]', async () => {
      await page.getByTestId('user.sign-in.code.dialog.cancel-button').click()
      // Expected: After step 5 [user.sign-in.code.dialog] is gone and the URL is still
      //   [screen:user.sign-in]
      await expect(dialog).toHaveCount(0)
      await expectPathname(page, CONTRACT_ROUTES['user.sign-in'])
    })

    await test.step('6. Click [user.sign-in.submit-button] again', async () => {
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 6 [user.sign-in.code.dialog] carries [code:code-required] again
      await expect(dialog).toHaveAttribute('data-code', 'code-required')
    })

    await test.step('7. Enter a code the key does not give now into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]', async () => {
      await submitCode(page, await wrongCodeFor(key))
      // Expected: After step 7 [user.sign-in.code.error] carries [code:invalid-code] under
      //   [user.sign-in.code.code-input], and the URL is still [screen:user.sign-in]
      await expect(error).toHaveAttribute('data-code', 'invalid-code')

      const [field, message] = await Promise.all([codeInput.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the code',
      ).toBe(true)
      await expectPathname(page, CONTRACT_ROUTES['user.sign-in'])
    })

    await test.step('8. Enter the code the authenticator app shows now for the key into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]', async () => {
      await submitCode(page, await totpFor(key))
      // Expected: After step 8 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [screen:user.profile]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
    })
  })
})
