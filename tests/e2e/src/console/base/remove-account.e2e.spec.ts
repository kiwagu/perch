// scenario: console/base/remove-account
import { expectAddress, openAccount, openUsers, signUpOperator } from '../../support/console'
import { generate } from '../../support/data'
import { appReady, expect, expectPathname, signUp, test, toast } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import { nextDeclaredNotice } from '../../support/notice-contract'
import {
  acceptOnOrg,
  createOrganisation,
  expectMembers,
  inviteEmail,
  memberItem,
} from '../../support/organisation'
import { databases, identityDatabase } from '../../support/storage'

test.describe('Remove an account', { tag: '@full' }, () => {
  test("The removal of an organisation's only administrator is refused while other members are in, the operator's own account is refused, and the removal then goes through with its notice", async ({
    page,
    freshDevices,
  }) => {
    // Three accounts sign up, each waiting for its sync channel, and two organisation flows run.
    test.slow()

    const data = {
      operatorEmail: generate.operatorEmail(),
      operatorName: generate.operatorName(),
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
      otherEmail: generate.otherEmail(),
      otherName: generate.otherName(),
      organisationKey: generate.tenantKey(),
      organisationName: generate.organisationName(),
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
      await test.step('2. On device B, sign up with the email, the password and the name, open the link of [mail:sign-up], open [/org], enter the organisation key and the organisation name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const b = await freshDevices.open()

        await signUp(b, {
          ...generate.account(),
          email: data.email,
          password: data.password,
          name: data.name,
        })
        // Device B hears that its account went over its sync channel.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        // Device B's database of the account, which the removal must delete.
        const name = await identityDatabase(b)

        await expect.poll(() => databases(b)).toContain(name)
        await b.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(b, { key: data.organisationKey, name: data.organisationName })

        return { deviceB: b, databaseOfB: name }
      })

    const deviceC =
      await test.step('3. On device C, sign up with the other email, the password and the other name, open the link of [mail:sign-up] and wait for [/me]', async () => {
        const c = await freshDevices.open()

        await signUp(c, {
          ...generate.account(),
          email: data.otherEmail,
          password: data.password,
          name: data.otherName,
        })

        return c
      })

    await test.step('4. On device B, invite the other email with [organisation.invite.email-input] and [organisation.invite.submit-button]', async () => {
      await inviteEmail(deviceB, data.otherEmail)
    })

    await test.step("5. On device C, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await acceptOnOrg(deviceC, data.organisationName)
    })

    const id =
      await test.step("6. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button] and click [console.users.list.open-link] on the account's [console.users.list.account-item]", async () => {
        await openUsers(page)

        const opened = await openAccount(page, data.email)

        // Expected: After step 6 [console.account.organisations.list] on device A holds one
        //   [console.account.organisations.item] whose [console.account.organisations.name-cell]
        //   shows the organisation name and whose [console.account.organisations.role-badge]
        //   carries [value:admin]
        await expect(
          page
            .getByTestId('console.account.organisations.list')
            .getByTestId('console.account.organisations.item'),
        ).toHaveCount(1)
        await expect(page.getByTestId('console.account.organisations.name-cell')).toHaveText(
          data.organisationName,
        )
        await expect(page.getByTestId('console.account.organisations.role-badge')).toHaveAttribute(
          'data-value',
          'admin',
        )

        return opened
      })

    await test.step('7. On device A, click [console.account.removal.remove-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await page.getByTestId('console.account.removal.remove-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 7 [console.account.removal.error] carries [code:last-admin] on device
      //   A, the card stays, and device B stays on [/org]
      await expect(page.getByTestId('console.account.removal.error')).toHaveAttribute(
        'data-code',
        'last-admin',
      )
      await expectAddress(page, '/console/account', { id })
      await expect(page.getByTestId('console.account.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.getByTestId('console.account.email-cell')).toHaveText(data.email)
      await expectPathname(deviceB, '/org')
      await expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(
        data.organisationName,
      )
    })

    await test.step('8. On device A, open [/console/users], enter the operator email into [console.users.search-input], click [console.users.search-button], click [console.users.list.open-link] on its own [console.users.list.account-item], click [console.account.removal.remove-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await openUsers(page)
      await openAccount(page, data.operatorEmail)
      await page.getByTestId('console.account.removal.remove-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 8 [console.account.removal.error] carries [code:own-account] on
      //   device A, whose card shows [console.account.operator-badge], and device A stays signed
      //   in
      await expect(page.getByTestId('console.account.removal.error')).toHaveAttribute(
        'data-code',
        'own-account',
      )
      await expect(page.getByTestId('console.account.operator-badge')).toBeVisible()
      await expectPathname(page, '/console/account')
      await expect(page.getByTestId('app-shell.nav')).toBeVisible()
    })

    await test.step("9. On device B, reload [/org], click [organisation.members.remove-button] on the other account's [organisation.members.item] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await deviceB.reload()
      await appReady(deviceB)
      await memberItem(deviceB, data.otherEmail)
        .getByTestId('organisation.members.remove-button')
        .click()
      await deviceB.getByTestId('app-shell.confirmation.confirm-button').click()
      // The removal is done once device B's members list holds its own account alone.
      await expect(memberItem(deviceB, data.otherEmail)).toHaveCount(0)
      await expectMembers(deviceB, [data.email])
    })

    await test.step("10. On device A, open [/console/users], enter the email into [console.users.search-input], click [console.users.search-button], click [console.users.list.open-link] on the account's [console.users.list.account-item], click [console.account.removal.remove-button] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await openUsers(page)
      await openAccount(page, data.email)

      // The email's mails before the removal: the sign-up's, which the notice follows.
      const seen = await mailbox.count(data.email)

      await page.getByTestId('console.account.removal.remove-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 10 [app-shell.toast] carries [code:account-removed] on device A,
      //   whose URL is [/console/users], and [console.users.list] no longer holds the account's
      //   [console.users.list.account-item]; within 5 seconds device B is on [/sign-in] and its
      //   browser keeps no local database of the account;
      //   [notice:accounts.remove.account-deleted] reaches the email; on device C, [/org] shows no
      //   membership of the organisation, which went with the account
      await Promise.all([
        (async () => {
          await expect(toast(page, 'account-removed')).toBeVisible()
          await expectAddress(page, '/console/users', {})
          await expect(page.getByTestId('console.users.list')).toHaveAttribute(
            'data-state',
            'ready',
          )
          await expect(
            page.locator(`[data-testid="console.users.list.account-item"][data-id="${id}"]`),
          ).toHaveCount(0)
        })(),
        expectPathname(deviceB, '/sign-in', 5_000),
        expect
          .poll(() => databases(deviceB), {
            message: "device B's database of the account",
            timeout: 5_000,
          })
          .not.toContain(databaseOfB),
      ])
      // In the account's language, the address it had.
      await nextDeclaredNotice(
        'accounts.remove.account-deleted',
        { params: {}, account: { email: data.email, language: 'en' } },
        seen,
      )
      await expect(deviceC.getByTestId('organisation.page.status')).toHaveAttribute(
        'data-state',
        'empty',
      )
      await expect(deviceC.getByTestId('organisation.page.heading')).toHaveCount(0)
    })
  })
})
