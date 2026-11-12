// scenario: organisation/flows/invitation-elsewhere
import { generate } from '../../support/data'
import { expect, expectPathname, signUp, test } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import { createOrganisation, expectInvitationMail, inviteEmail } from '../../support/organisation'

test.describe("Open an invitation's link elsewhere than in the invited account", {
  tag: '@full',
}, () => {
  test('Another account sees the organisation and the role with an error and nothing to press; a guest is asked to sign in to the invited account, with the link to the sign-in page', async ({
    page,
    anotherAccount,
    freshDevice,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      invitedEmail: generate.email(),
    }

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
      await test.step('3. On device A, enter the invited email into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
        const seen = await mailbox.count(data.invitedEmail)

        await inviteEmail(page, data.invitedEmail)

        // No account has the invited email: its mail speaks the inviter's language.
        return expectInvitationMail(
          { email: data.invitedEmail, inviter: { email: userA.email, language: 'en' } },
          seen,
        )
      })

    await test.step('4. On device B, open the link of the [mail:organisations.invite] that reached the invited email', async () => {
      await openMailLink(deviceB, mail, 'organisations.invite')
      // Expected: After step 4 device B shows the organisation name in
      //   [organisation.invitation.heading], [organisation.invitation.role-badge] carrying
      //   [value:member] and [organisation.invitation.error] carrying [code:other-account], and
      //   neither [organisation.invitation.accept-button] nor
      //   [organisation.invitation.decline-button]
      await expect(deviceB.getByTestId('organisation.invitation.heading')).toHaveText(data.name)
      await expect(deviceB.getByTestId('organisation.invitation.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(deviceB.getByTestId('organisation.invitation.error')).toHaveAttribute(
        'data-code',
        'other-account',
      )
      await expect(deviceB.getByTestId('organisation.invitation.accept-button')).toHaveCount(0)
      await expect(deviceB.getByTestId('organisation.invitation.decline-button')).toHaveCount(0)
    })

    const deviceC = await test.step('5. On device C, open the same link', async () => {
      const c = await freshDevice.open()

      await openMailLink(c, mail, 'organisations.invite')
      // Expected: After step 5 device C shows the organisation name in
      //   [organisation.invitation.heading], [organisation.invitation.message] carrying
      //   [code:sign-in-to-accept] and [organisation.invitation.sign-in-link], and neither
      //   [organisation.invitation.accept-button] nor [organisation.invitation.decline-button]
      await expect(c.getByTestId('organisation.invitation.heading')).toHaveText(data.name)
      await expect(c.getByTestId('organisation.invitation.message')).toHaveAttribute(
        'data-code',
        'sign-in-to-accept',
      )
      await expect(c.getByTestId('organisation.invitation.sign-in-link')).toBeVisible()
      await expect(c.getByTestId('organisation.invitation.accept-button')).toHaveCount(0)
      await expect(c.getByTestId('organisation.invitation.decline-button')).toHaveCount(0)

      return c
    })

    await test.step('6. On device C, click [organisation.invitation.sign-in-link]', async () => {
      await deviceC.getByTestId('organisation.invitation.sign-in-link').click()
      // Expected: After step 6 the URL is [/sign-in] on device C
      await expectPathname(deviceC, '/sign-in')
    })
  })
})
