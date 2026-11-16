// scenario: organisation/base/accept-by-link
import { generate } from '../../support/data'
import { expect, expectPathname, signUp, test, toast } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import { createOrganisation, expectInvitationMail, inviteEmail } from '../../support/organisation'

test.describe('Accept an invitation by the link of its mail', { tag: '@full' }, () => {
  test("The invitation mail speaks the invited account's language; its link shows the organisation and the role and, accepted, opens the organisation; the same link then no longer works", async ({
    page,
    anotherAccount,
  }) => {
    const data = { key: generate.tenantKey(), name: generate.organisationName() }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, open [/sign-in], choose [value:es] in [app-shell.locale-select], sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', async () => {
        const b = await anotherAccount.open()

        await signUp(b, userB, 'es')

        return b
      })

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

        // Expected: After step 3 [mail:organisations.invite] reaches user B's email in the
        //   language [value:es], user B's and not user A's
        return expectInvitationMail(
          {
            email: userB.email,
            inviter: { email: userA.email, language: 'en' },
            recipientLanguage: 'es',
          },
          seen,
        )
      })

    await test.step('4. On device B, open the link of [mail:organisations.invite]', async () => {
      await openMailLink(deviceB, mail, 'organisations.invite')
      // Expected: After step 4 the link opens [/invitation], [organisation.invitation.heading]
      //   shows the organisation name, [organisation.invitation.role-badge] carries
      //   [value:member], and [organisation.invitation.accept-button] and
      //   [organisation.invitation.decline-button] show; the page shows no email
      await expectPathname(deviceB, '/invitation')
      await expect(deviceB.getByTestId('organisation.invitation.heading')).toHaveText(data.name)
      await expect(deviceB.getByTestId('organisation.invitation.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(deviceB.getByTestId('organisation.invitation.accept-button')).toBeVisible()
      await expect(deviceB.getByTestId('organisation.invitation.decline-button')).toBeVisible()
      await expect(deviceB.locator('body')).not.toContainText(userB.email)
    })

    await test.step('5. On device B, click [organisation.invitation.accept-button]', async () => {
      await deviceB.getByTestId('organisation.invitation.accept-button').click()
      // Expected: After step 5 the URL is [/org], [app-shell.toast] carries
      //   [code:invitation-accepted], [organisation.page.heading] shows the organisation name and
      //   [organisation.page.role-badge] carries [value:member]
      await Promise.all([
        expect(toast(deviceB, 'invitation-accepted')).toBeVisible(),
        expectPathname(deviceB, '/org', 10_000),
      ])
      await expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(data.name)
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
    })

    await test.step('6. On device B, open the link of [mail:organisations.invite] again', async () => {
      await openMailLink(deviceB, mail, 'organisations.invite')
      // Expected: After step 6 [organisation.invitation.error] carries [code:link-invalid], and
      //   neither [organisation.invitation.accept-button] nor
      //   [organisation.invitation.decline-button] shows
      await expect(deviceB.getByTestId('organisation.invitation.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(deviceB.getByTestId('organisation.invitation.accept-button')).toHaveCount(0)
      await expect(deviceB.getByTestId('organisation.invitation.decline-button')).toHaveCount(0)
    })
  })
})
