// scenario: organisation/base/copy-invitation-link
import { firstLink } from '@workspace/mailbox'

import { frontOf } from '../../support/browsers'
import { generate } from '../../support/data'
import { expect, expectPathname, signUp, test, toast } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import {
  createOrganisation,
  expectInvitationMail,
  inviteEmail,
  sentItems,
} from '../../support/organisation'

test.describe("Copy an invitation's link", { tag: '@full' }, () => {
  test('The copied link is the link the invitation mail carries, and it lets the invited account join', async ({
    page,
    anotherAccount,
    baseURL,
  }) => {
    const data = { key: generate.tenantKey(), name: generate.organisationName() }
    const userB = anotherAccount.account

    // Device A's page reads what it copied.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: frontOf(baseURL),
    })

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

    const copied =
      await test.step("4. On device A, click [organisation.sent.copy-button] on user B's [organisation.sent.item]", async () => {
        await sentItems(page)
          .filter({ hasText: userB.email })
          .getByTestId('organisation.sent.copy-button')
          .click()
        // Expected: After step 4 [app-shell.toast] carries [code:link-copied] on device A, and
        //   the clipboard holds the link of the [mail:organisations.invite] that reached user B's
        //   email
        await expect(toast(page, 'link-copied')).toBeVisible()
        const link = await page.evaluate(() => navigator.clipboard.readText())

        // Compared in fixed words: the link carries a token, which a failure must not print.
        expect(
          link === firstLink(mail),
          'the copied link is not the link of [mail:organisations.invite]',
        ).toBe(true)

        return link
      })

    await test.step('5. On device B, open the link copied on device A and click [organisation.invitation.accept-button]', async () => {
      try {
        await deviceB.goto(copied)
      } catch {
        throw new Error('the copied link did not open')
      }

      await deviceB.getByTestId('organisation.invitation.accept-button').click()
      // Expected: After step 5 the URL is [/org] on device B, [app-shell.toast] carries
      //   [code:invitation-accepted] and [organisation.page.role-badge] carries [value:member]
      await Promise.all([
        expect(toast(deviceB, 'invitation-accepted')).toBeVisible(),
        expectPathname(deviceB, '/org', 10_000),
      ])
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
    })
  })
})
