// scenario: user/flows/sign-in-with-passkey

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { generate } from '../../support/data'
import { expect, expectPathname, notice, signOut, signUp, test } from '../../support/fixtures'
import { codeDialog, turnSecondFactorOn } from '../../support/second-factor'
import { watchShown } from '../../support/shown'
import { addVirtualAuthenticator } from '../../support/virtual-authenticator'

test.describe('Sign in with a passkey', { tag: '@full' }, () => {
  test('A passkey signs the account in with no password and no code, even with the second factor on, and one removed from the account signs nothing in', async ({
    page,
  }) => {
    // Three sign-outs and sign-ins wait for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }
    const list = page.getByTestId('user.settings.passkeys.list')
    const items = page.getByTestId('user.settings.passkeys.passkey-item')
    const passkeyButton = page.getByTestId('user.sign-in.passkey-button')

    // The browser's authenticator makes passkeys, unlocks them at once and keeps them until the
    // browser closes, whatever the account does with them.
    await addVirtualAuthenticator(page)

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and click [user.settings.passkeys.add-button]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(list).toHaveAttribute('data-state', 'empty')
      await page.getByTestId('user.settings.passkeys.add-button').click()
      // The passkey is on the account once the list holds it.
      await expect(items).toHaveCount(1)
    })

    await test.step('2. Enter the password into [user.settings.two-factor.password-input], click [user.settings.two-factor.enable-button], enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input], click [user.settings.two-factor.confirm-button] and click [user.settings.two-factor.hide-codes-button]', async () => {
      await turnSecondFactorOn(page, data.password)
      await page.getByTestId('user.settings.two-factor.hide-codes-button').click()
    })

    await test.step('3. Click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
      await signOut(page)
    })

    await test.step('4. Click [user.sign-in.passkey-button]', async () => {
      const codeDialogShown = await watchShown(page, '[data-testid="user.sign-in.code.dialog"]')

      await passkeyButton.click()
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome], the URL is
      //   [/me], and [user.sign-in.code.dialog] never showed
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
      expect(await codeDialogShown(), 'the code dialog never showed').toBe(false)
      await expect(codeDialog(page)).toHaveCount(0)
    })

    await test.step('5. Click [app-shell.nav.settings-link], click [user.settings.passkeys.remove-button] of the passkey and click [app-shell.confirmation.confirm-button]', async () => {
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(items).toHaveCount(1)
      await page.getByTestId('user.settings.passkeys.remove-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 5 [user.settings.passkeys.list] holds no
      //   [user.settings.passkeys.passkey-item]
      await expect(items).toHaveCount(0)
      await expect(list).toHaveAttribute('data-state', 'empty')
    })

    await test.step('6. Click [app-shell.nav.profile-link], click [user.profile.sign-out-button] and click [user.sign-in.passkey-button]', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expectPathname(page, CONTRACT_ROUTES['user.profile'])
      await signOut(page)
      await passkeyButton.click()
      // Expected: After step 6 the authenticator offers the passkey it still keeps,
      //   [user.sign-in.error] carries [code:passkey-unknown], and the URL is still [/sign-in]:
      //   the account no longer has that passkey
      await expect(page.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'passkey-unknown',
      )
      await expectPathname(page, CONTRACT_ROUTES['user.sign-in'])
    })
  })
})
