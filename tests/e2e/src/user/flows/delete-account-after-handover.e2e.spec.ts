// scenario: user/flows/delete-account-after-handover
import {
  accountDeleted,
  askToDeleteAccount,
  deleteAccount,
  openDeletionMail,
  openSettings,
} from '../../support/account-deletion'
import { generate } from '../../support/data'
import { appReady, expect, signUp, test, toast } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import {
  acceptOnOrg,
  chooseMemberRole,
  createOrganisation,
  expectMembers,
  inviteEmail,
  memberItem,
} from '../../support/organisation'

test.describe('Hand an organisation over, then delete the account', { tag: '@full' }, () => {
  test('The only administrator makes a member an administrator, makes itself a member, then deletes its account; the organisation stays with the new administrator and keeps the note the deleted account wrote', async ({
    page,
    anotherAccount,
  }) => {
    // Two accounts sign up, and the deletion signs device A out, which waits for its sync channel.
    test.slow()

    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
    }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', () =>
        anotherAccount.signUp())

    const userA =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], create the organisation with [organisation.create.submit-button], enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)
        await page.getByTestId('organisation.notes.new-textarea').fill(data.noteByA)
        await page.getByTestId('organisation.notes.add-button').click()
        await expect(
          page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
        ).toHaveText([data.noteByA])

        return account
      })

    await test.step('3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      await inviteEmail(page, userB.email)
    })

    await test.step("4. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await acceptOnOrg(deviceB, data.name)
    })

    await test.step("5. On device A, reload [/org] and, on user B's [organisation.members.item], set [organisation.members.role-select] to [value:admin]", async () => {
      await page.reload()
      await appReady(page)
      await chooseMemberRole(page, userB.email, 'admin')
      // The change is done once its toast shows; the toast is let go, so step 6's is its own.
      await expect(toast(page, 'role-changed')).toBeVisible()
      await expect(toast(page, 'role-changed')).toHaveCount(0, { timeout: 15_000 })
      await expect(
        memberItem(page, userB.email).getByTestId('organisation.members.role-select'),
      ).toHaveAttribute('data-value', 'admin')
    })

    await test.step('6. On device A, on its own [organisation.members.item], set [organisation.members.role-select] to [value:member]', async () => {
      await chooseMemberRole(page, userA.email, 'member')
      // Expected: After step 6 [app-shell.toast] carries [code:role-changed] on device A,
      //   [organisation.page.role-badge] carries [value:member], and no
      //   [organisation.members.list] and no [organisation.invite.form] show
      await expect(toast(page, 'role-changed')).toBeVisible()
      await expect(page.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(page.getByTestId('organisation.members.list')).toHaveCount(0)
      await expect(page.getByTestId('organisation.invite.form')).toHaveCount(0)
    })

    await test.step("7. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of its [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await openSettings(page)

      // User A's mails before the request: the sign-up's alone, user A is invited by nobody.
      const mails = await mailbox.count(userA.email)

      await askToDeleteAccount(page, userA.password)
      await openDeletionMail(page, userA.email, mails)
      await deleteAccount(page)
      // Expected: After step 7 [user.delete-account.message] carries [code:account-deleted] on
      //   device A
      await expect(accountDeleted(page)).toBeVisible({ timeout: 10_000 })
    })

    await test.step('8. On device B, reload [/org] and wait for [organisation.notes.section] to reach [state:ready]', async () => {
      await deviceB.reload()
      await appReady(deviceB)
      await expect(deviceB.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'ready',
        { timeout: 10_000 },
      )
      // Expected: After step 8 device B shows [organisation.page.role-badge] carrying
      //   [value:admin], [organisation.members.list] holding only user B's
      //   [organisation.members.item], and the note by A in [organisation.notes.list]
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'admin',
      )
      await expectMembers(deviceB, [userB.email])
      await expect(
        deviceB.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA])
    })
  })
})
