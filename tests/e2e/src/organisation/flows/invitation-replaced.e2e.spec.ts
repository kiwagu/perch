// scenario: organisation/flows/invitation-replaced
import { generate } from '../../support/data'
import { expect, expectPathname, signUp, test, toast } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import {
  createOrganisation,
  expectInvitationMail,
  type InvitationMail,
  inviteEmail,
  sentItems,
} from '../../support/organisation'

test.describe('Invite the same email again', { tag: '@full' }, () => {
  test('A second invitation of an email replaces the first: the first link no longer works, and the second makes the account an administrator', async ({
    page,
    anotherAccount,
  }) => {
    const data = { key: generate.tenantKey(), name: generate.organisationName() }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', () =>
        anotherAccount.signUp())

    const invitation =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async (): Promise<InvitationMail> => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)

        return {
          email: userB.email,
          inviter: { email: account.email, language: 'en' },
          recipientLanguage: 'en',
        }
      })

    const first =
      await test.step('3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
        // User B's mails before the invitation: its sign-up's, which the invitation follows.
        const seen = await mailbox.count(userB.email)

        await inviteEmail(page, userB.email)

        return expectInvitationMail(invitation, seen)
      })

    const second =
      await test.step('4. On device A, set [organisation.invite.role-select] to [value:admin], enter the email of user B into [organisation.invite.email-input] again and click [organisation.invite.submit-button]', async () => {
        const seen = await mailbox.count(userB.email)
        const roleSelect = page.getByTestId('organisation.invite.role-select')

        await roleSelect.click()
        await page
          .locator('[data-testid="organisation.invite.role-select.option"][data-value="admin"]')
          .click()
        await page.getByTestId('organisation.invite.email-input').fill(userB.email)
        await page.getByTestId('organisation.invite.submit-button').click()
        await expect(toast(page, 'invited')).toBeVisible()
        // Expected: After step 4 device A's [organisation.sent.list] holds one
        //   [organisation.sent.item], user B's, whose [organisation.sent.role-badge] carries
        //   [value:admin], and [organisation.invite.role-select] shows [value:member] again
        await expect(sentItems(page).getByTestId('organisation.sent.role-badge')).toHaveAttribute(
          'data-value',
          'admin',
        )
        await expect(sentItems(page)).toHaveCount(1)
        await expect(sentItems(page).getByTestId('organisation.sent.email-cell')).toHaveText(
          userB.email,
        )
        await expect(roleSelect).toHaveAttribute('data-value', 'member')

        return expectInvitationMail(invitation, seen)
      })

    await test.step('5. On device B, open the link of the first [mail:organisations.invite]', async () => {
      await openMailLink(deviceB, first, 'organisations.invite')
      // Expected: After step 5 [organisation.invitation.error] carries [code:link-invalid] on
      //   device B
      await expect(deviceB.getByTestId('organisation.invitation.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
    })

    await test.step('6. On device B, open the link of the second [mail:organisations.invite] and click [organisation.invitation.accept-button]', async () => {
      await openMailLink(deviceB, second, 'organisations.invite')
      await deviceB.getByTestId('organisation.invitation.accept-button').click()
      await expectPathname(deviceB, '/org', 10_000)
      // Expected: After step 6 [organisation.page.role-badge] carries [value:admin] on device B,
      //   and [organisation.members.list] shows
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'admin',
      )
      await expect(deviceB.getByTestId('organisation.members.list')).toBeVisible()
    })
  })
})
