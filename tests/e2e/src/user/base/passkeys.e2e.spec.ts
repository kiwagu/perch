// scenario: user/base/passkeys
import { generate } from '../../support/data'
import { expect, signUp, test, toast } from '../../support/fixtures'
import { addVirtualAuthenticator } from '../../support/virtual-authenticator'

test.describe('Add and remove a passkey in the settings', { tag: '@full' }, () => {
  test("A passkey is added by the browser, listed, and removed only once the frame's question is confirmed", async ({
    page,
  }) => {
    const data = { ...generate.account(), name: generate.name() }
    const list = page.getByTestId('user.settings.passkeys.list')
    const items = page.getByTestId('user.settings.passkeys.passkey-item')
    const add = page.getByTestId('user.settings.passkeys.add-button')
    const remove = page.getByTestId('user.settings.passkeys.remove-button')
    const confirmation = page.getByTestId('app-shell.confirmation')

    // The browser's authenticator makes passkeys and unlocks them at once.
    await addVirtualAuthenticator(page)

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.passkeys.list] to leave [state:loading]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      // Expected: After step 1 [user.settings.passkeys.list] carries [state:empty]
      await expect(list).toHaveAttribute('data-state', 'empty')
    })

    await test.step('2. Click [user.settings.passkeys.add-button]', async () => {
      await add.click()
      // Expected: After step 2 [app-shell.toast] carries [code:passkey-added] and
      //   [user.settings.passkeys.list] carries [state:ready] with one
      //   [user.settings.passkeys.passkey-item], whose [user.settings.passkeys.added-cell] says
      //   when it was added
      await expect(toast(page, 'passkey-added')).toBeVisible()
      await expect(list).toHaveAttribute('data-state', 'ready')
      await expect(items).toHaveCount(1)
      await expect(items.first().getByTestId('user.settings.passkeys.added-cell')).toHaveText(/\S/)
    })

    await test.step('3. Click [user.settings.passkeys.remove-button] of the passkey', async () => {
      await remove.click()
      // Expected: After step 3 [app-shell.confirmation] carries [code:passkeys-remove]
      await expect(confirmation).toHaveAttribute('data-code', 'passkeys-remove')
    })

    await test.step('4. Click [app-shell.confirmation.cancel-button]', async () => {
      await page.getByTestId('app-shell.confirmation.cancel-button').click()
      // Expected: After step 4 [app-shell.confirmation] is gone and
      //   [user.settings.passkeys.list] still holds the passkey
      await expect(confirmation).toHaveCount(0)
      await expect(items).toHaveCount(1)
    })

    await test.step('5. Click [user.settings.passkeys.remove-button] of the passkey and click [app-shell.confirmation.confirm-button]', async () => {
      await remove.click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 5 [app-shell.toast] carries [code:passkey-removed] and
      //   [user.settings.passkeys.list] carries [state:empty]
      await expect(toast(page, 'passkey-removed')).toBeVisible()
      await expect(list).toHaveAttribute('data-state', 'empty')
    })
  })
})
