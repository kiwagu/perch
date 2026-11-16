// scenario: organisation/base/decline-invitation
import { generate } from '../../support/data'
import { expect, signUp, test, toast } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import {
  createOrganisation,
  expectInvitationMail,
  expectMembers,
  invitationsRead,
  inviteEmail,
  receivedItem,
} from '../../support/organisation'

test.describe('Decline an invitation on the organisation page', { tag: '@full' }, () => {
  test("The invited account declines on its organisation page; the invitation leaves its list and the administrator's, and its link no longer works", async ({
    page,
    anotherAccount,
  }) => {
    const data = { key: generate.tenantKey(), name: generate.organisationName() }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', () =>
        anotherAccount.signUp())

    const userA =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)

        return account
      })

    const mail =
      await test.step('3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
        const seen = await mailbox.count(userB.email)

        await inviteEmail(page, userB.email)

        return expectInvitationMail(
          {
            email: userB.email,
            inviter: { email: userA.email, language: 'en' },
            recipientLanguage: 'en',
          },
          seen,
        )
      })

    await test.step("4. On device B, open [/org] and click [organisation.received.decline-button] on the organisation's [organisation.received.item]", async () => {
      await deviceB.getByTestId('app-shell.nav.organisation-link').click()
      await receivedItem(deviceB, data.name)
        .getByTestId('organisation.received.decline-button')
        .click()
      // Expected: After step 4 [app-shell.toast] carries [code:invitation-declined] on device
      //   B, no [organisation.received.list] shows, and [organisation.page.status] stays in
      //   [state:empty]
      await expect(toast(deviceB, 'invitation-declined')).toBeVisible()
      await expect(deviceB.getByTestId('organisation.received.list')).toHaveCount(0)
      await expect(deviceB.getByTestId('organisation.page.status')).toHaveAttribute(
        'data-state',
        'empty',
      )
    })

    await test.step('5. On device A, reload [/org]', async () => {
      const sent = invitationsRead(page, 'sent')

      await page.reload()
      // Expected: After step 5 device A shows no [organisation.sent.list], and
      //   [organisation.members.list] holds only user A's [organisation.members.item]
      await expectMembers(page, [userA.email])
      expect(await sent, 'the invitations sent, read after the reload').toBe(0)
      await expect(page.getByTestId('organisation.sent.list')).toHaveCount(0)
    })

    await test.step('6. On device B, open the link of [mail:organisations.invite]', async () => {
      await openMailLink(deviceB, mail, 'organisations.invite')
      // Expected: After step 6 [organisation.invitation.error] carries [code:link-invalid] on
      //   device B
      await expect(deviceB.getByTestId('organisation.invitation.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
    })
  })
})
