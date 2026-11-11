// scenario: console/base/sessions-and-mails
import { expectAddress, openAccount, openUsers, signUpOperator } from '../../support/console'
import { generate } from '../../support/data'
import {
  appReady,
  expect,
  expectPathname,
  notice,
  signInNotice,
  signUp,
  startSignUp,
  test,
  toast,
} from '../../support/fixtures'
import { expectDeclaredMail, openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import { enterNewPassword } from '../../support/password-reset'

test.describe('Sign an account out everywhere and send it its mails', { tag: '@full' }, () => {
  test('The operator signs the account out everywhere, sends it a password reset the account completes, and sends an unverified account its verification mail again', async ({
    page,
    freshDevices,
  }) => {
    // Three accounts sign up and device B signs in again, each waiting for its sync channel.
    test.slow()

    const data = {
      operatorEmail: generate.operatorEmail(),
      operatorName: generate.operatorName(),
      email: generate.email(),
      password: generate.password(),
      newPassword: generate.newPassword(),
      name: generate.name(),
      otherEmail: generate.otherEmail(),
      otherName: generate.otherName(),
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
        const b = await freshDevices.open()

        await signUp(b, {
          ...generate.account(),
          email: data.email,
          password: data.password,
          name: data.name,
        })
        // Device B hears that it was signed out over its sync channel, and is seen at its hello.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        return b
      })

    const deviceC =
      await test.step('3. On device C, sign up with the other email, the password and the other name, without opening the link', async () => {
        const c = await freshDevices.open()

        await startSignUp(c, {
          ...generate.account(),
          email: data.otherEmail,
          password: data.password,
          name: data.otherName,
        })

        return c
      })

    const id =
      await test.step("4. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]", async () => {
        await openUsers(page)

        const opened = await openAccount(page, data.email)

        // Expected: After step 4 [console.account.seen-cell] shows on device A, since the
        //   account's device was seen just now
        await expect(page.getByTestId('console.account.seen-cell')).toBeVisible()

        return opened
      })

    await test.step('5. On device A, click [console.account.sessions.revoke-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await page.getByTestId('console.account.sessions.revoke-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 5 [app-shell.toast] carries [code:sessions-revoked] on device A and
      //   the card stays; within 5 seconds device B is on [/sign-in], where
      //   [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
      await Promise.all([
        (async () => {
          await expect(toast(page, 'sessions-revoked')).toBeVisible()
          await expectAddress(page, '/console/account', { id })
          await expect(page.getByTestId('console.account.section')).toHaveAttribute(
            'data-state',
            'ready',
          )
          await expect(page.getByTestId('console.account.email-cell')).toHaveText(data.email)
        })(),
        expectPathname(deviceB, '/sign-in', 5_000),
        expect(signInNotice(deviceB, 'signed-out-elsewhere')).toBeVisible({ timeout: 5_000 }),
      ])
    })

    const resetMail =
      await test.step('6. On device A, click [console.account.reset.send-button]', async () => {
        // The email's mails before the request: the sign-up's.
        const seen = await mailbox.count(data.email)

        await page.getByTestId('console.account.reset.send-button').click()
        // Expected: After step 6 [app-shell.toast] carries [code:reset-sent] on device A, and
        //   [mail:accounts.send-reset] reaches the email
        await expect(toast(page, 'reset-sent')).toBeVisible()

        const sent = await mailbox.next(data.email, seen)

        // The account's mail, in the language it signed up in.
        expectDeclaredMail(sent, 'accounts.send-reset', {
          params: {},
          account: { email: data.email, language: 'en' },
        })

        return sent
      })

    await test.step('7. On device B, open the link of [mail:accounts.send-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input] and click [user.reset-password.submit-button]', async () => {
      await openMailLink(deviceB, resetMail, 'accounts.send-reset')
      await expectPathname(deviceB, '/reset-password')
      await enterNewPassword(deviceB, data.newPassword)
      // Expected: After step 7 [user.reset-password.message] carries [code:password-reset] on
      //   device B
      await expect(deviceB.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
    })

    await test.step('8. On device B, open [/sign-in], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await deviceB.goto('/sign-in')
      await appReady(deviceB)
      await deviceB.getByTestId('user.sign-in.email-input').fill(data.email)
      await deviceB.getByTestId('user.sign-in.password-input').fill(data.newPassword)
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 8 device B is on [/me] and [app-shell.notice-message] carries
      //   [code:welcome]: the account signs in with the new password
      await expect(notice(deviceB, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(deviceB, '/me')
    })

    await test.step("9. On device A, open [/console/users], enter the other email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the other account's [console.users.list.account-item]", async () => {
      await openUsers(page)
      await openAccount(page, data.otherEmail)
      // Expected: After step 9 [console.account.heading] shows the other name, no
      //   [console.account.verified-badge] shows, [console.account.verification.resend-button]
      //   shows and no [console.account.name.form] does, since the account has no profile yet
      await expect(page.getByTestId('console.account.heading')).toHaveText(data.otherName)
      await expect(page.getByTestId('console.account.verified-badge')).toHaveCount(0)
      await expect(page.getByTestId('console.account.verification.resend-button')).toBeVisible()
      await expect(page.getByTestId('console.account.name.form')).toHaveCount(0)
    })

    const resent =
      await test.step('10. On device A, click [console.account.verification.resend-button]', async () => {
        // The sign-up's mail, which device C left unopened, has to be in the mailbox before the
        // baseline is taken: the gateway sends it after it answered, so a count taken at once
        // could read zero, and the sign-up's mail would then pass for the resend's.
        await mailbox.next(data.otherEmail, 0)

        // The other email's mails before the request: the sign-up's alone.
        const seen = await mailbox.count(data.otherEmail)

        expect(seen, "the other email's mails before the request").toBe(1)

        await page.getByTestId('console.account.verification.resend-button').click()
        // Expected: After step 10 [app-shell.toast] carries [code:verification-sent] on device A,
        //   and [mail:accounts.resend-verification] reaches the other email
        await expect(toast(page, 'verification-sent')).toBeVisible()

        const sent = await mailbox.next(data.otherEmail, seen)

        // The other account's mail, in the language it signed up in.
        expectDeclaredMail(sent, 'accounts.resend-verification', {
          params: {},
          account: { email: data.otherEmail, language: 'en' },
        })

        return sent
      })

    await test.step('11. On device C, open the link of [mail:accounts.resend-verification]', async () => {
      await openMailLink(deviceC, resent, 'accounts.resend-verification')
      // Expected: After step 11 device C is on [/me] and [app-shell.notice-message] carries
      //   [code:welcome]: the link verified the email and signed the device in
      await expect(notice(deviceC, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(deviceC, '/me')
    })
  })
})
