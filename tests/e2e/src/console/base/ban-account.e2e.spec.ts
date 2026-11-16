// scenario: console/base/ban-account
import { openAccount, openUsers, signUpOperator } from '../../support/console'
import { generate } from '../../support/data'
import {
  expect,
  expectPathname,
  notice,
  signInNotice,
  signUp,
  test,
  toast,
} from '../../support/fixtures'
import { databases, identityDatabase } from '../../support/storage'

test.describe('Ban an account and lift the ban', { tag: '@full' }, () => {
  test("A ban signs the account's device out and tells it plainly, its sign-in is refused, and once the ban is lifted it signs in again", async ({
    page,
    freshDevice,
  }) => {
    // Two accounts sign up and device B signs in again, each waiting for its sync channel.
    test.slow()

    const data = {
      operatorEmail: generate.operatorEmail(),
      operatorName: generate.operatorName(),
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
      reason: generate.reason(),
    }

    await test.step("1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page", async () => {
      await signUpOperator(page, {
        ...generate.account(),
        email: data.operatorEmail,
        password: data.password,
        name: data.operatorName,
      })
    })

    const { deviceB, databaseOfB } =
      await test.step('2. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
        const b = await freshDevice.open()

        await signUp(b, {
          ...generate.account(),
          email: data.email,
          password: data.password,
          name: data.name,
        })
        // Device B hears that it was signed out over its sync channel.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        // Device B's database of the account, which the ban must delete.
        const name = await identityDatabase(b)

        await expect.poll(() => databases(b)).toContain(name)

        return { deviceB: b, databaseOfB: name }
      })

    await test.step("3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]", async () => {
      await openUsers(page)
      await openAccount(page, data.email)
    })

    await test.step('4. On device A, enter the reason into [console.account.ban.reason-input], click [console.account.ban.ban-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await page.getByTestId('console.account.ban.reason-input').fill(data.reason)
      await page.getByTestId('console.account.ban.ban-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 4 [app-shell.toast] carries [code:ban-set] on device A,
      //   [console.account.banned-badge] shows, [console.account.reason-cell] shows the reason,
      //   [console.account.ban.reason-input] is empty, [console.account.ban.unban-button] shows and
      //   [console.account.ban.ban-button] does not; within 5 seconds device B is on [/sign-in],
      //   where [user.sign-in.notice-message] carries [code:account-banned] and nothing names the
      //   reason, and its browser keeps no local database of the account
      await Promise.all([
        (async () => {
          await expect(toast(page, 'ban-set')).toBeVisible()
          await expect(page.getByTestId('console.account.banned-badge')).toBeVisible()
          await expect(page.getByTestId('console.account.reason-cell')).toContainText(data.reason)
          // "is empty": the reason input shows only while the account is not banned (its anchor's
          // description), so a banned account's card has none and holds no reason; step 6 sees it
          // again, empty.
          await expect(page.getByTestId('console.account.ban.reason-input')).toHaveCount(0)
          await expect(page.getByTestId('console.account.ban.unban-button')).toBeVisible()
          await expect(page.getByTestId('console.account.ban.ban-button')).toHaveCount(0)
        })(),
        expectPathname(deviceB, '/sign-in', 5_000),
        expect(signInNotice(deviceB, 'account-banned')).toBeVisible({ timeout: 5_000 }),
        expect
          .poll(() => databases(deviceB), {
            message: "device B's database of the account",
            timeout: 5_000,
          })
          .not.toContain(databaseOfB),
      ])
      await expect(deviceB.locator('body')).not.toContainText(data.reason)
    })

    await test.step('5. On device B, enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await deviceB.getByTestId('user.sign-in.email-input').fill(data.email)
      await deviceB.getByTestId('user.sign-in.password-input').fill(data.password)
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 5 [user.sign-in.error] carries [code:account-banned] on device B, and
      //   the URL stays [/sign-in]
      await expect(deviceB.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'account-banned',
      )
      await expectPathname(deviceB, '/sign-in')
    })

    await test.step('6. On device A, click [console.account.ban.unban-button]', async () => {
      await page.getByTestId('console.account.ban.unban-button').click()
      // Expected: After step 6 [app-shell.toast] carries [code:ban-lifted] on device A,
      //   [console.account.banned-badge] no longer shows, nor does [console.account.reason-cell],
      //   and [console.account.ban.ban-button] shows again
      await expect(toast(page, 'ban-lifted')).toBeVisible()
      await expect(page.getByTestId('console.account.banned-badge')).toHaveCount(0)
      await expect(page.getByTestId('console.account.reason-cell')).toHaveCount(0)
      await expect(page.getByTestId('console.account.ban.ban-button')).toBeVisible()
      // The reason input shows again with the ban form, empty: step 4's ban cleared it.
      await expect(page.getByTestId('console.account.ban.reason-input')).toHaveValue('')
    })

    await test.step('7. On device B, click [user.sign-in.submit-button] again', async () => {
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 7 device B is on [/me] and [app-shell.notice-message] carries
      //   [code:welcome]
      await expect(notice(deviceB, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(deviceB, '/me')
    })
  })
})
