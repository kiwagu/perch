// scenario: console/flows/operator-revoked
import {
  consoleLink,
  expectAddress,
  openAccount,
  openUsers,
  signUpOperator,
} from '../../support/console'
import { generate } from '../../support/data'
import { appReady, expect, expectPathname, signUp, test } from '../../support/fixtures'
import { revokeOperator } from '../../support/operators'

test.describe('Take the operator role away while the console is open', { tag: '@full' }, () => {
  test('The open console of an operator whose role was taken away turns into the not-found page at its next action, and the console link leaves the navigation', async ({
    page,
    freshDevice,
  }) => {
    // Two accounts sign up, each waiting for its sync channel.
    test.slow()

    const data = {
      operatorEmail: generate.operatorEmail(),
      operatorName: generate.operatorName(),
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
    }

    await test.step("1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page", async () => {
      await signUpOperator(page, {
        ...generate.account(),
        email: data.operatorEmail,
        password: data.password,
        name: data.operatorName,
      })
    })

    const deviceB =
      await test.step('2. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
        const b = await freshDevice.open()

        await signUp(b, {
          ...generate.account(),
          email: data.email,
          password: data.password,
          name: data.name,
        })
        // Device B would hear a sign-out over its sync channel.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        return b
      })

    const id =
      await test.step("3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]", async () => {
        await openUsers(page)

        const opened = await openAccount(page, data.email)

        // Expected: After step 3 [console.account.section] is in [state:ready] on device A, and
        //   [app-shell.nav] shows [app-shell.nav.console-link]
        await expect(page.getByTestId('console.account.section')).toHaveAttribute(
          'data-state',
          'ready',
        )
        await expect(consoleLink(page)).toBeVisible()

        return opened
      })

    await test.step("4. Take the operator role away from device A's account by the host's command, as an operator is appointed", async () => {
      await revokeOperator(data.operatorEmail)
    })

    await test.step('5. On device A, click [console.account.sessions.revoke-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await page.getByTestId('console.account.sessions.revoke-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 5 the address is still [/console/account] with its search on device
      //   A, [not-found.page.heading] shows in place of the card, no [console.account.section]
      //   shows, [app-shell.nav] shows no [app-shell.nav.console-link], and device B stays on
      //   [/me], signed in
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expect(page.getByTestId('console.account.section')).toHaveCount(0)
      await expectAddress(page, '/console/account', { id })
      await expect(page.getByTestId('app-shell.nav')).toBeVisible()
      await expect(consoleLink(page)).toHaveCount(0)
      // The gateway refused the request, so nothing signed device B out: it is still on its
      // profile, with the navigation of a signed-in device.
      await expectPathname(deviceB, '/me')
      await expect(deviceB.getByTestId('app-shell.nav')).toBeVisible()
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.name)
    })

    await test.step('6. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 6 [not-found.page.heading] still shows on device A at the same
      //   address
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expectAddress(page, '/console/account', { id })
      // The roles come with the welcome of the device's hello, before its sync channel is up:
      // with them in, the navigation still shows no console link.
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expect(consoleLink(page)).toHaveCount(0)
    })
  })
})
