// scenario: console/flows/email-change-before-verifying
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
import { mailbox } from '../../support/mailbox'
import { nextDeclaredNotice } from '../../support/notice-contract'

test.describe('Change the email of an account that never signed in', { tag: '@full' }, () => {
  test("An operator's email change confirmed from the new mailbox verifies the new email, and the account's first sign-in with it starts the account", async ({
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
      newEmail: generate.newEmail(),
    }
    // The confirmation mail goes to the new email, in the language the account signed up in.
    const confirmation = {
      params: { email: data.newEmail },
      account: { email: data.email, language: 'en' },
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
      // Expected: After step 3 neither [console.account.verified-badge] nor
      //   [console.account.name.form] shows on device A: the email is not verified and the
      //   account has no profile yet
      await expect(page.getByTestId('console.account.verified-badge')).toHaveCount(0)
      await expect(page.getByTestId('console.account.name.form')).toHaveCount(0)
    })

    const seenAtNewEmail =
      await test.step('4. On device A, enter the new email into [console.account.email.email-input] and click [console.account.email.send-button]', async () => {
        // The new email's mails before the request: none, as no account has it.
        const seen = await mailbox.count(data.newEmail)

        await page.getByTestId('console.account.email.email-input').fill(data.newEmail)
        await page.getByTestId('console.account.email.send-button').click()
        // The request is answered before device B looks for its mail: the toast says so.
        await expect(toast(page, 'email-change-sent')).toBeVisible()

        return seen
      })

    await test.step('5. On device B, open the link of [mail:accounts.change-email]', async () => {
      // The sign-up's mail, which device B left unopened, has to be in the mailbox before the
      // baseline is taken: the gateway sends it after it answered, so a count taken too early
      // could read zero, and the sign-up's mail would then pass for the notice.
      await mailbox.next(data.email, 0)

      // The email's mails before the link: the sign-up's alone.
      const seen = await mailbox.count(data.email)

      expect(seen, "the email's mails before the link").toBe(1)

      await openDeclaredMail(deviceB, 'accounts.change-email', confirmation, seenAtNewEmail)
      // Expected: After step 5 [user.confirm-email.message] carries [code:email-changed] on device
      //   B, beside [user.confirm-email.sign-in-link], and [notice:confirm-email.email-changed]
      //   reaches the email
      await expectPathname(deviceB, '/confirm-email')
      await expect(deviceB.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
      await expect(deviceB.getByTestId('user.confirm-email.sign-in-link')).toBeVisible()
      // In the account's language, naming no part of the new email, as the notice declares.
      await nextDeclaredNotice(
        'confirm-email.email-changed',
        { params: {}, account: { email: data.email, language: 'en' }, hides: data.newEmail },
        seen,
      )
    })

    await test.step('6. On device B, click [user.confirm-email.sign-in-link], enter the new email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await deviceB.getByTestId('user.confirm-email.sign-in-link').click()
      await expectPathname(deviceB, '/sign-in')
      await deviceB.getByTestId('user.sign-in.email-input').fill(data.newEmail)
      await deviceB.getByTestId('user.sign-in.password-input').fill(data.password)
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 6 device B is on [/me], [app-shell.notice-message] carries
      //   [code:welcome] and [user.profile.heading] shows the name: the first sign-in created the
      //   account's profile with the name it signed up with
      await expect(notice(deviceB, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(deviceB, '/me')
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
    })

    await test.step('7. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 7 [console.account.email-cell] on device A shows the new email, and
      //   both [console.account.verified-badge] and [console.account.name.form] show
      await expect(page.getByTestId('console.account.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.getByTestId('console.account.email-cell')).toHaveText(data.newEmail)
      await expect(page.getByTestId('console.account.verified-badge')).toBeVisible()
      await expect(page.getByTestId('console.account.name.form')).toBeVisible()
    })
  })
})
