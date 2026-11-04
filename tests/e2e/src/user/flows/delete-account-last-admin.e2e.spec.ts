// scenario: user/flows/delete-account-last-admin
import {
  accountDeleted,
  askToDeleteAccount,
  deleteAccount,
  openDeletionMail,
  openSettings,
  sendDeletionRequest,
} from '../../support/account-deletion'
import { generate } from '../../support/data'
import { expect, signUp, test, toast } from '../../support/fixtures'
import { expectBoundedNonArrival } from '../../support/mailbox'
import { createOrganisation, inviteMember } from '../../support/organisation'

test.describe('Delete an account that administers an organisation with other members', {
  tag: '@full',
}, () => {
  test('The deletion is refused while other members are in; once they are removed, the account goes with its organisation, and the key is free', async ({
    page,
    anotherAccount,
  }) => {
    // Two accounts sign up, and the deletion signs device A out, which waits for its sync channel.
    test.slow()

    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
    }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', async () => {
        const b = await anotherAccount.signUp()

        await expect(b.getByTestId('user.profile.heading')).toHaveText(userB.name)

        return b
      })

    const userA =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)

        return account
      })

    await test.step('3. On device A, invite user B with [organisation.invite.email-input] and [organisation.invite.submit-button]', async () => {
      await inviteMember(page, userB.email)
    })

    await test.step("4. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]", async () => {
      await openSettings(page)

      const answeredAt = await sendDeletionRequest(page, userA.password)

      // Expected: After step 4 [user.settings.deletion.error] carries [code:last-admin] on device
      //   A, and no [mail:request-account-deletion] reaches user A's email
      await expect(page.getByTestId('user.settings.deletion.error')).toHaveAttribute(
        'data-code',
        'last-admin',
      )
      await expect(page.getByTestId('user.settings.deletion.message')).toHaveCount(0)
      // Within the delivery window after the gateway's answer user A's email still holds the mail
      // of its sign-up alone (bounded non-arrival).
      await expectBoundedNonArrival(userA.email, { mails: 1, answeredAt })
    })

    await test.step("5. On device A, open [/org], click [organisation.members.remove-button] on user B's [organisation.members.item] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await page.getByTestId('app-shell.nav.organisation-link').click()
      // The refused request of step 4 left the password typed, which the deletion form keeps
      // (only a sent mail empties it), so the frame asks before the leave loses it; the step
      // goes on to [/org].
      await expect(
        page.locator('[data-testid="app-shell.leave-dialog"][data-code="unsaved-input"]'),
      ).toBeVisible()
      await page.getByTestId('app-shell.leave-dialog.confirm-button').click()
      await expect(page.getByTestId('organisation.page.heading')).toHaveText(data.name)

      const itemOfB = page.getByTestId('organisation.members.item').filter({ hasText: userB.email })

      await itemOfB.getByTestId('organisation.members.remove-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // The removal is done once device A's members list holds user A alone.
      await expect(itemOfB).toHaveCount(0)
      await expect(page.getByTestId('organisation.members.item')).toHaveText([userA.email])
    })

    await test.step("6. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of its [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await openSettings(page)
      await askToDeleteAccount(page, userA.password)
      // User A's second mail, after the sign-up's: the refused request of step 4 sent none.
      await openDeletionMail(page, userA.email, 1)
      await deleteAccount(page)
      // Expected: After step 6 [user.delete-account.message] carries [code:account-deleted] on
      //   device A
      await expect(accountDeleted(page)).toBeVisible({ timeout: 10_000 })
    })

    await test.step('7. On device B, open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
      await deviceB.getByTestId('app-shell.nav.organisation-link').click()
      await expect(deviceB.getByTestId('organisation.page.status')).toHaveAttribute(
        'data-state',
        'empty',
      )
      // Expected: After step 7 [app-shell.toast] carries [code:organisation-created] on device B
      //   and [organisation.page.heading] shows the organisation name: the key was freed with
      //   user A's organisation
      // Watched while the helper checks the page, so the toast's short life is not spent first.
      await Promise.all([
        createOrganisation(deviceB, data),
        expect(toast(deviceB, 'organisation-created')).toBeVisible(),
      ])
    })
  })
})
