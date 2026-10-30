// scenario: app-shell/base/outdated-protocol
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { SyncNetwork } from '../../support/network'

test.describe('Hear that the server no longer takes the protocol of this version', {
  tag: '@full',
}, () => {
  test('A signed-in tab whose sync the server refuses as an outdated protocol says so, and its button loads the page again', async ({
    page,
  }) => {
    const network = await SyncNetwork.attach(page)
    const updateMessage = page.getByTestId('app-shell.update-message')

    await test.step('1. Sign up and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
      await signUp(page)
      await appReady(page)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 15_000,
      })
      // Expected: After step 1 no [app-shell.update-message] shows
      await expect(updateMessage).toHaveCount(0)
    })

    await test.step('2. Make the server refuse the sync protocol of the version the tab runs: it closes the sync connection as an outdated protocol', async () => {
      await network.refuseProtocol()
      // Expected: After step 2 [app-shell.update-message] carries [code:protocol-outdated], with
      //   [app-shell.update-button],
      await expect(updateMessage).toHaveAttribute('data-code', 'protocol-outdated')
      await expect(page.getByTestId('app-shell.update-button')).toBeEnabled()
      //   and [app-shell.sync-message] carries [code:sync-stopped]
      await expect(page.getByTestId('app-shell.sync-message')).toHaveAttribute(
        'data-code',
        'sync-stopped',
      )
    })

    await test.step('3. Click [app-shell.update-button]', async () => {
      // The page loaded again runs the build the server serves, whose protocol it takes.
      network.acceptProtocol()

      const loaded = page.waitForEvent('load')

      await page.getByTestId('app-shell.update-button').click()
      await loaded
      // Expected: After step 3 the page loads again on the version the server serves,
      //   [app-shell.status] reaches [state:ready] on [/me] and no [app-shell.update-message] shows
      await appReady(page)
      await expect(page).toHaveURL(/\/me$/)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 15_000,
      })
      await expect(updateMessage).toHaveCount(0)
    })
  })
})
