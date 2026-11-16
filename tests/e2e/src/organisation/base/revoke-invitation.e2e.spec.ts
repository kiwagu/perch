// scenario: organisation/base/revoke-invitation
import { generate } from '../../support/data'
import { expect, signUp, test, toast } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import {
  createOrganisation,
  expectInvitationMail,
  invitationsRead,
  inviteEmail,
  sentItems,
} from '../../support/organisation'

test.describe('Revoke an invitation', { tag: '@full' }, () => {
  test('An administrator revokes a pending invitation once the frame has asked; its link then no longer works, and the invited account has no invitation', async ({
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

    await test.step("4. On device A, click [organisation.sent.revoke-button] on user B's [organisation.sent.item] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await sentItems(page)
        .filter({ hasText: userB.email })
        .getByTestId('organisation.sent.revoke-button')
        .click()
      // Expected: At step 4 [app-shell.confirmation] carries
      //   [code:organisations-revoke-invitation]; after it [app-shell.toast] carries
      //   [code:invitation-revoked] on device A and no [organisation.sent.list] shows
      await expect(
        page.locator(
          '[data-testid="app-shell.confirmation"][data-code="organisations-revoke-invitation"]',
        ),
      ).toBeVisible()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      await expect(toast(page, 'invitation-revoked')).toBeVisible()
      await expect(page.getByTestId('organisation.sent.list')).toHaveCount(0)
    })

    await test.step('5. On device B, open the link of [mail:organisations.invite]', async () => {
      await openMailLink(deviceB, mail, 'organisations.invite')
      // Expected: After step 5 [organisation.invitation.error] carries [code:link-invalid] on
      //   device B
      await expect(deviceB.getByTestId('organisation.invitation.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
    })

    await test.step('6. On device B, open [/org]', async () => {
      const received = invitationsRead(deviceB, 'received')

      await deviceB.getByTestId('app-shell.nav.organisation-link').click()
      // Expected: After step 6 device B shows [organisation.page.status] in [state:empty] and no
      //   [organisation.received.list]
      await expect(deviceB.getByTestId('organisation.page.status')).toHaveAttribute(
        'data-state',
        'empty',
      )
      expect(await received, 'the invitations for user B, read on opening the page').toBe(0)
      await expect(deviceB.getByTestId('organisation.received.list')).toHaveCount(0)
    })
  })
})
