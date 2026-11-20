// scenario: console/flows/banned-before-verifying
import { openAccount, openUsers, signUpOperator } from '../../support/console'
import { generate } from '../../support/data'
import {
  appReady,
  expect,
  expectPathname,
  notice,
  startSignUp,
  test,
  toast,
} from '../../support/fixtures'
import { openDeclaredMail } from '../../support/mail-contract'

test.describe('Ban an account before it verified its email', { tag: '@full' }, () => {
  test("A banned account's verification link still verifies the email but signs nothing in and says the account is banned, its sign-in is refused as banned, not as unverified, and once the ban is lifted its first sign-in starts it", async ({
    page,
    freshDevice,
  }) => {
    // Two accounts sign up, the operator waiting for its sync channel, and device B signs in.
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
      await test.step('2. On device B, sign up with the email, the password and the name, without opening the link', async () => {
        const b = await freshDevice.open()

        await startSignUp(b, {
          ...generate.account(),
          email: data.email,
          password: data.password,
          name: data.name,
        })

        return b
      })

    await test.step("3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]", async () => {
      await openUsers(page)
      await openAccount(page, data.email)
    })

    await test.step('4. On device A, click [console.account.ban.ban-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await page.getByTestId('console.account.ban.ban-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 4 [app-shell.toast] carries [code:ban-set] on device A,
      //   [console.account.banned-badge] shows and no [console.account.reason-cell] does, since no
      //   reason was given; no [console.account.verified-badge] shows
      await expect(toast(page, 'ban-set')).toBeVisible()
      // The badge shows once the card is read again after the ban, so the absences are of that read.
      await expect(page.getByTestId('console.account.banned-badge')).toBeVisible()
      await expect(page.getByTestId('console.account.reason-cell')).toHaveCount(0)
      await expect(page.getByTestId('console.account.verified-badge')).toHaveCount(0)
    })

    await test.step('5. On device B, open the link of [mail:sign-up]', async () => {
      // The email's first mail, the sign-up's, which device B left unopened.
      await openDeclaredMail(deviceB, 'sign-up', { params: { email: data.email, locale: 'en' } }, 0)
      // Expected: After step 5 [user.verify-email.error] carries [code:account-banned] on device
      //   B, no [user.verify-email.form] shows, and device B is not signed in: its URL stays
      //   [/verify-email]
      await expect(deviceB.getByTestId('user.verify-email.error')).toHaveAttribute(
        'data-code',
        'account-banned',
      )
      await expect(deviceB.getByTestId('user.verify-email.form')).toHaveCount(0)
      await expectPathname(deviceB, '/verify-email')
      // Only a signed-in device shows the navigation.
      await expect(deviceB.getByTestId('app-shell.nav')).toHaveCount(0)
    })

    await test.step('6. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await deviceB.goto('/sign-in')
      await appReady(deviceB)
      await deviceB.getByTestId('user.sign-in.email-input').fill(data.email)
      await deviceB.getByTestId('user.sign-in.password-input').fill(data.password)
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 6 [user.sign-in.error] carries [code:account-banned] on device B, not
      //   [code:email-not-verified]: the error carries one code, so account-banned excludes it
      await expect(deviceB.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'account-banned',
      )
      await expectPathname(deviceB, '/sign-in')
    })

    await test.step('7. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 7 [console.account.verified-badge] shows on device A: the link
      //   verified the email; no [console.account.name.form] shows, since the account has no
      //   profile yet
      await expect(page.getByTestId('console.account.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.getByTestId('console.account.email-cell')).toHaveText(data.email)
      await expect(page.getByTestId('console.account.verified-badge')).toBeVisible()
      await expect(page.getByTestId('console.account.name.form')).toHaveCount(0)
    })

    await test.step('8. On device A, click [console.account.ban.unban-button]', async () => {
      await page.getByTestId('console.account.ban.unban-button').click()
      // The ban is lifted before device B signs in again: the toast says the request was answered.
      await expect(toast(page, 'ban-lifted')).toBeVisible()
    })

    await test.step('9. On device B, click [user.sign-in.submit-button] again', async () => {
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 9 device B is on [/me], [app-shell.notice-message] carries
      //   [code:welcome] and [user.profile.heading] shows the name: the first sign-in created the
      //   account's profile with the name it signed up with
      await expect(notice(deviceB, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(deviceB, '/me')
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
    })

    await test.step('10. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 10 [console.account.name.form] shows on device A
      await expect(page.getByTestId('console.account.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.getByTestId('console.account.name.form')).toBeVisible()
    })
  })
})
