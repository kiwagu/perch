// scenario: user/flows/delete-account-leaves-organisation
import {
  accountDeleted,
  askToDeleteAccount,
  deleteAccount,
  openDeletionMail,
  openSettings,
} from '../../support/account-deletion'
import { generate } from '../../support/data'
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import {
  acceptOnOrg,
  createOrganisation,
  expectInvitationMail,
  expectMembers,
  inviteEmail,
} from '../../support/organisation'

test.describe("Delete an account that is a member of another account's organisation", {
  tag: '@full',
}, () => {
  test('The deleted account leaves the organisation, and the note it wrote stays', async ({
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

    const userA =
      await test.step('1. On device A, sign up as user A, open the link of its [mail:sign-up] and wait for [/me]', async () => {
        const account = await signUp(page)

        await expect(page.getByTestId('user.profile.heading')).toHaveText(account.name)

        return account
      })

    const { deviceB, seen } =
      await test.step('2. On device B, sign up as user B, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input], click [organisation.create.submit-button], and invite user A with [organisation.invite.email-input] and [organisation.invite.submit-button]', async () => {
        const b = await anotherAccount.signUp()

        await b.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(b, data)

        // User A's mails before the invitation: its sign-up's, which the invitation follows.
        const mails = await mailbox.count(userA.email)

        await inviteEmail(b, userA.email)

        return { deviceB: b, seen: mails }
      })

    await test.step("3. On device A, open [/org], click [organisation.received.accept-button] on the organisation's [organisation.received.item], wait for [organisation.page.heading] to show the organisation name, enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]", async () => {
      // Accepts, then waits for the heading to show the organisation name.
      await acceptOnOrg(page, data.name)
      await page.getByTestId('organisation.notes.new-textarea').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add-button').click()
      // Expected: Within 5 seconds of step 3 [organisation.notes.list] on device B holds the note
      //   by A
      await expect(
        deviceB.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA], { timeout: 5_000 })
    })

    await test.step("4. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of its [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await openSettings(page)

      // The invitation mail is read, held to its declaration, before the mails are counted: the
      // deletion's is the one after them.
      await expectInvitationMail(
        {
          email: userA.email,
          inviter: { email: userB.email, language: 'en' },
          recipientLanguage: 'en',
        },
        seen,
      )

      const mails = await mailbox.count(userA.email)

      await askToDeleteAccount(page, userA.password)
      await openDeletionMail(page, userA.email, mails)
      await deleteAccount(page)
      // Expected: After step 4 [user.delete-account.message] carries [code:account-deleted] on
      //   device A
      await expect(accountDeleted(page)).toBeVisible({ timeout: 10_000 })
    })

    await test.step('5. On device B, reload [/org] and wait for [organisation.notes.section] to reach [state:ready]', async () => {
      await deviceB.reload()
      await appReady(deviceB)
      await expect(deviceB.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'ready',
        { timeout: 10_000 },
      )
    })

    // Expected: After step 5 [organisation.members.list] on device B holds only user B's
    //   [organisation.members.item], and [organisation.notes.list] still holds the note by A
    await expectMembers(deviceB, [userB.email])
    await expect(
      deviceB.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
    ).toHaveText([data.noteByA])
  })
})
