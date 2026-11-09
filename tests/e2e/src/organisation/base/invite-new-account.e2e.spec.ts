// scenario: organisation/base/invite-new-account
import { generate } from '../../support/data'
import { expect, signUp, test, toast } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import {
  createOrganisation,
  expectInvitationMail,
  expectMembers,
  receivedItem,
  sentItems,
} from '../../support/organisation'

test.describe('Invite an email that has no account yet', () => {
  test("An invitation to an email with no account is mailed in the inviter's language and waits; the account later made with that email finds it on the organisation page and joins", async ({
    page,
    freshDevices,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      invitedEmail: generate.email(),
      password: generate.password(),
      userName: generate.name(),
    }

    const userA =
      await test.step('1. On device A, open [/sign-in], choose [value:es] in [app-shell.locale-select], sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const account = await signUp(page, undefined, 'es')

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)

        return account
      })

    await test.step('2. On device A, enter the invited email into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      const seen = await mailbox.count(data.invitedEmail)

      await page.getByTestId('organisation.invite.email-input').fill(data.invitedEmail)
      await page.getByTestId('organisation.invite.submit-button').click()
      // Expected: After step 2 [app-shell.toast] carries [code:invited] on device A,
      //   [organisation.invite.email-input] is empty, [organisation.invite.role-select] shows
      //   [value:member], and [organisation.sent.list] holds one [organisation.sent.item], whose
      //   [organisation.sent.email-cell] shows the invited email and whose
      //   [organisation.sent.role-badge] carries [value:member]
      await expect(toast(page, 'invited')).toBeVisible()
      await expect(page.getByTestId('organisation.invite.email-input')).toHaveValue('')
      await expect(page.getByTestId('organisation.invite.role-select')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(sentItems(page)).toHaveCount(1)
      await expect(sentItems(page).getByTestId('organisation.sent.email-cell')).toHaveText(
        data.invitedEmail,
      )
      await expect(sentItems(page).getByTestId('organisation.sent.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      // Expected: After step 2 [mail:organisations.invite] reaches the invited email in the
      //   language [value:es], user A's, as no account has that email yet
      await expectInvitationMail(
        { email: data.invitedEmail, inviter: { email: userA.email, language: 'es' } },
        seen,
      )
    })

    const deviceB =
      await test.step('3. On device B, sign up with the invited email, the password and the name, open the link of [mail:sign-up] and open [/org]', async () => {
        const b = await freshDevices.open()

        await signUp(b, {
          ...generate.account(),
          email: data.invitedEmail,
          password: data.password,
          name: data.userName,
        })
        await b.getByTestId('app-shell.nav.organisation-link').click()
        // Expected: After step 3 device B shows [organisation.page.status] in [state:empty] and
        //   [organisation.received.list] with one [organisation.received.item], whose
        //   [organisation.received.name-cell] shows the organisation name and whose
        //   [organisation.received.role-badge] carries [value:member]
        await expect(b.getByTestId('organisation.page.status')).toHaveAttribute(
          'data-state',
          'empty',
        )
        const items = b
          .getByTestId('organisation.received.list')
          .getByTestId('organisation.received.item')

        await expect(items).toHaveCount(1)
        await expect(items.getByTestId('organisation.received.name-cell')).toHaveText(data.name)
        await expect(items.getByTestId('organisation.received.role-badge')).toHaveAttribute(
          'data-value',
          'member',
        )

        return b
      })

    await test.step("4. On device B, click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await receivedItem(deviceB, data.name)
        .getByTestId('organisation.received.accept-button')
        .click()
      // Expected: After step 4 [app-shell.toast] carries [code:invitation-accepted] on device B,
      //   [organisation.page.heading] shows the organisation name,
      //   [organisation.page.role-badge] carries [value:member], and no
      //   [organisation.received.list] shows
      await Promise.all([
        expect(toast(deviceB, 'invitation-accepted')).toBeVisible(),
        expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(data.name, {
          timeout: 10_000,
        }),
      ])
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(deviceB.getByTestId('organisation.received.list')).toHaveCount(0)
    })

    await test.step('5. On device A, reload [/org]', async () => {
      await page.reload()
      // Expected: After step 5 device A shows user B's [organisation.members.item] in
      //   [organisation.members.list] and no [organisation.sent.list]
      await expectMembers(page, [userA.email, data.invitedEmail])
      await expect(page.getByTestId('organisation.sent.list')).toHaveCount(0)
    })
  })
})
