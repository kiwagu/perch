// scenario: console/base/edit-account
import type { Page } from '@playwright/test'

import { expectAddress, openAccount, openUsers, signUpOperator } from '../../support/console'
import { generate } from '../../support/data'
import {
  appReady,
  expect,
  expectPathname,
  pageLoads,
  signUp,
  test,
  toast,
} from '../../support/fixtures'
import { expectDeclaredMail, openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import { nextDeclaredNotice } from '../../support/notice-contract'

/** The card of an account as read on `page`, before anything changes it. */
async function expectCard(
  page: Page,
  account: { readonly name: string; readonly email: string },
): Promise<void> {
  await expect(page.getByTestId('console.account.section')).toHaveAttribute('data-state', 'ready')
  await expect(page.getByTestId('console.account.heading')).toHaveText(account.name)
  await expect(page.getByTestId('console.account.email-cell')).toHaveText(account.email)
  await expect(page.getByTestId('console.account.verified-badge')).toBeVisible()
  await expect(page.getByTestId('console.account.banned-badge')).toHaveCount(0)
  await expect(page.getByTestId('console.account.operator-badge')).toHaveCount(0)
}

test.describe('Rename an account and change its email from its card', { tag: '@full' }, () => {
  test("A row opens the account's card, the operator renames the account, which its own device shows, and changes its email, which the new mailbox confirms", async ({
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
      newName: generate.newName(),
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

    const { deviceB, loadsOfB } =
      await test.step('2. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
        const b = await freshDevice.open()

        await signUp(b, {
          ...generate.account(),
          email: data.email,
          password: data.password,
          name: data.name,
        })
        // Device B hears the rename over its sync channel.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        return { deviceB: b, loadsOfB: pageLoads(b) }
      })

    const id =
      await test.step("3. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]", async () => {
        await openUsers(page)

        const opened = await openAccount(page, data.email)

        // Expected: After step 3 the URL is [/console/account] with the account's id as its
        //   search, [console.account.section] is in [state:ready], [console.account.heading] shows
        //   the name, [console.account.email-cell] shows the email,
        //   [console.account.verified-badge] shows, and neither [console.account.banned-badge] nor
        //   [console.account.operator-badge] does
        await expectAddress(page, '/console/account', { id: opened })
        await expectCard(page, data)

        return opened
      })

    await test.step('4. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 4 the card is the same: the address alone names the account
      await expectAddress(page, '/console/account', { id })
      await expectCard(page, data)
    })

    await test.step('5. On device A, enter the new name into [console.account.name.name-input] and click [console.account.name.save-button]', async () => {
      await page.getByTestId('console.account.name.name-input').fill(data.newName)
      await page.getByTestId('console.account.name.save-button').click()
      // Expected: After step 5 [app-shell.toast] carries [code:name-saved] on device A and
      //   [console.account.heading] shows the new name; within 5 seconds [user.profile.heading] on
      //   device B shows the new name, without a reload
      await Promise.all([
        (async () => {
          await expect(toast(page, 'name-saved')).toBeVisible()
          await expect(page.getByTestId('console.account.heading')).toHaveText(data.newName)
        })(),
        expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.newName, {
          timeout: 5_000,
        }),
      ])
      expect(loadsOfB(), 'pages device B loaded since it signed up').toBe(0)
    })

    const mail =
      await test.step('6. On device A, enter the new email into [console.account.email.email-input] and click [console.account.email.send-button]', async () => {
        // The new email's mails before the request: none, as no account has it.
        const seen = await mailbox.count(data.newEmail)

        await page.getByTestId('console.account.email.email-input').fill(data.newEmail)
        await page.getByTestId('console.account.email.send-button').click()
        // Expected: After step 6 [app-shell.toast] carries [code:email-change-sent] on device A,
        //   [console.account.email.email-input] is empty, [console.account.email-cell] still shows
        //   the email, and [mail:accounts.change-email] reaches the new email
        await expect(toast(page, 'email-change-sent')).toBeVisible()
        await expect(page.getByTestId('console.account.email.email-input')).toHaveValue('')
        await expect(page.getByTestId('console.account.email-cell')).toHaveText(data.email)

        const sent = await mailbox.next(data.newEmail, seen)

        expectDeclaredMail(sent, 'accounts.change-email', confirmation)

        return sent
      })

    await test.step('7. On device B, open the link of [mail:accounts.change-email]', async () => {
      // The email's mails before the change: the sign-up's, which the notice follows.
      const seen = await mailbox.count(data.email)

      await openMailLink(deviceB, mail, 'accounts.change-email')
      // Expected: After step 7 [user.confirm-email.message] carries [code:email-changed] on device
      //   B, and [notice:confirm-email.email-changed] reaches the email
      await expectPathname(deviceB, '/confirm-email')
      await expect(deviceB.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
      // In the account's language, naming no part of the new email, as the notice declares.
      await nextDeclaredNotice(
        'confirm-email.email-changed',
        { params: {}, account: { email: data.email, language: 'en' }, hides: data.newEmail },
        seen,
      )
    })

    await test.step('8. On device B, click [user.confirm-email.profile-link]', async () => {
      await deviceB.getByTestId('user.confirm-email.profile-link').click()
      // Expected: After step 8 device B is on [/me] and [user.profile.email-input] holds the new
      //   email
      await expectPathname(deviceB, '/me')
      await expect(deviceB.getByTestId('user.profile.email-input')).toHaveValue(data.newEmail, {
        timeout: 10_000,
      })
    })

    await test.step('9. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 9 [console.account.email-cell] on device A shows the new email, and
      //   [console.account.verified-badge] still shows
      await expect(page.getByTestId('console.account.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.getByTestId('console.account.email-cell')).toHaveText(data.newEmail)
      await expect(page.getByTestId('console.account.verified-badge')).toBeVisible()
    })
  })
})
