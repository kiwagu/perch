// scenario: user/base/two-factor

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { generate } from '../../support/data'
import { expect, expectPathname, signUp, test, toast } from '../../support/fixtures'
import { backupCodesShown, expectTwoFactorRead } from '../../support/second-factor'
import { totpFor, wrongCodeFor } from '../../support/totp'

test.describe('Turn the second factor on and off in the settings', { tag: '@smoke' }, () => {
  test('The second factor turns on only with a code of its key, shows its ten backup codes once, renews them with the password, and turns off with the password', async ({
    page,
  }) => {
    const data = { ...generate.account(), name: generate.name() }
    const password = page.getByTestId('user.settings.two-factor.password-input')
    const enable = page.getByTestId('user.settings.two-factor.enable-button')
    const key = page.getByTestId('user.settings.two-factor.key-cell')
    const code = page.getByTestId('user.settings.two-factor.code-input')
    const confirm = page.getByTestId('user.settings.two-factor.confirm-button')
    const error = page.getByTestId('user.settings.two-factor.error')
    const on = page.getByTestId('user.settings.two-factor.on-badge')
    const off = page.getByTestId('user.settings.two-factor.off-badge')
    const codesCell = page.getByTestId('user.settings.two-factor.codes-cell')
    const hide = page.getByTestId('user.settings.two-factor.hide-codes-button')
    const disable = page.getByTestId('user.settings.two-factor.disable-button')
    const renew = page.getByTestId('user.settings.two-factor.renew-codes-button')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.two-factor.section] to carry [state:ready]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expectTwoFactorRead(page)
      // Expected: After step 1 [user.settings.two-factor.off-badge] and
      //   [user.settings.two-factor.enable-button] are shown, and
      //   [user.settings.two-factor.on-badge] is not
      await expect(off).toBeVisible()
      await expect(enable).toBeVisible()
      await expect(on).toHaveCount(0)
    })

    const secret =
      await test.step('2. Enter the password into [user.settings.two-factor.password-input] and click [user.settings.two-factor.enable-button]', async () => {
        await password.fill(data.password)
        await enable.click()
        // Expected: After step 2 [user.settings.two-factor.key-cell] shows a key,
        //   [user.settings.two-factor.password-input] and
        //   [user.settings.two-factor.enable-button] are gone, and
        //   [user.settings.two-factor.on-badge] is not shown
        await expect(key).toHaveText(/^[A-Z2-7]+$/)
        await expect(password).toHaveCount(0)
        await expect(enable).toHaveCount(0)
        await expect(on).toHaveCount(0)

        return (await key.innerText()).trim()
      })

    await test.step('3. Enter a code the key in [user.settings.two-factor.key-cell] does not give now into [user.settings.two-factor.code-input] and click [user.settings.two-factor.confirm-button]', async () => {
      await code.fill(await wrongCodeFor(secret))
      await confirm.click()
      // Expected: After step 3 [user.settings.two-factor.error] carries [code:invalid-code]
      //   under [user.settings.two-factor.code-input], and [user.settings.two-factor.on-badge]
      //   is not shown
      await expect(error).toHaveAttribute('data-code', 'invalid-code')

      const [field, message] = await Promise.all([code.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the code',
      ).toBe(true)
      await expect(on).toHaveCount(0)
    })

    const enrolmentCodes =
      await test.step('4. Enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input] and click [user.settings.two-factor.confirm-button]', async () => {
        await code.fill(await totpFor(secret))
        await confirm.click()
        // Expected: After step 4 [app-shell.toast] carries [code:two-factor-enabled],
        //   [user.settings.two-factor.codes-cell] shows ten different backup codes, and
        //   [user.settings.two-factor.on-badge] is shown
        await expect(toast(page, 'two-factor-enabled')).toBeVisible()
        await expect(codesCell).toBeVisible()

        const shown = await backupCodesShown(page)

        expect(shown).toHaveLength(10)
        expect(new Set(shown).size, 'the ten backup codes differ').toBe(10)
        await expect(on).toBeVisible()

        return shown
      })

    await test.step('5. Click [user.settings.two-factor.hide-codes-button]', async () => {
      await hide.click()
      // Expected: After step 5 [user.settings.two-factor.codes-cell] is gone, and
      //   [user.settings.two-factor.disable-button] and
      //   [user.settings.two-factor.renew-codes-button] are shown
      await expect(codesCell).toHaveCount(0)
      await expect(disable).toBeVisible()
      await expect(renew).toBeVisible()
    })

    await test.step('6. Reload [/settings] and wait for [user.settings.two-factor.section] to carry [state:ready]', async () => {
      await page.reload()
      await expectTwoFactorRead(page)
      // Expected: After step 6 the URL is still [/settings], so the device stayed signed in
      //   through turning the second factor on; [user.settings.two-factor.on-badge] is shown and
      //   [user.settings.two-factor.codes-cell] is not: the codes showed once
      await expectPathname(page, CONTRACT_ROUTES['user.settings'])
      await expect(on).toBeVisible()
      await expect(codesCell).toHaveCount(0)
    })

    await test.step('7. Enter the password into [user.settings.two-factor.password-input] and click [user.settings.two-factor.renew-codes-button]', async () => {
      await password.fill(data.password)
      await renew.click()
      // Expected: After step 7 [user.settings.two-factor.codes-cell] shows ten backup codes,
      //   none of them one of step 4's
      await expect(codesCell).toBeVisible()

      const renewed = await backupCodesShown(page)

      expect(renewed).toHaveLength(10)
      expect(
        renewed.filter((renewedCode) => enrolmentCodes.includes(renewedCode)),
        "none of the new backup codes is one of step 4's",
      ).toEqual([])
    })

    await test.step('8. Click [user.settings.two-factor.hide-codes-button], enter the password into [user.settings.two-factor.password-input] and click [user.settings.two-factor.disable-button]', async () => {
      await hide.click()
      await password.fill(data.password)
      await disable.click()
      // Expected: After step 8 [app-shell.toast] carries [code:two-factor-disabled],
      //   [user.settings.two-factor.on-badge] is gone, [user.settings.two-factor.enable-button]
      //   is shown, and the URL is still [/settings]: the device stayed signed in
      await expect(toast(page, 'two-factor-disabled')).toBeVisible()
      await expect(on).toHaveCount(0)
      await expect(enable).toBeVisible()
      await expectPathname(page, CONTRACT_ROUTES['user.settings'])
    })

    await test.step('9. Reload [/settings] and wait for [user.settings.two-factor.section] to carry [state:ready]', async () => {
      await page.reload()
      await expectTwoFactorRead(page)
      // Expected: After step 9 the URL is still [/settings], [user.settings.two-factor.off-badge]
      //   and [user.settings.two-factor.enable-button] are shown: the device stayed signed in
      //   through turning the second factor off
      await expectPathname(page, CONTRACT_ROUTES['user.settings'])
      await expect(off).toBeVisible()
      await expect(enable).toBeVisible()
    })
  })
})
