// scenario: organisation/base/member-page
import { generate } from '../../support/data'
import { expect, signUp, test } from '../../support/fixtures'
import {
  acceptOnOrg,
  createOrganisation,
  expectMembers,
  inviteEmail,
  sentItems,
} from '../../support/organisation'

test.describe('Open the organisation page as a member', { tag: '@smoke' }, () => {
  test('An administrator invites an unknown email and an account alike; the account accepts on its organisation page and sees the organisation as a member, without its members or the invitations', async ({
    page,
    anotherAccount,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      unknownEmail: generate.email(),
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
        await expectMembers(page, [account.email])

        return account
      })

    await test.step('3. On device A, enter the unknown email into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      // Expected: After step 3 device A shows [app-shell.toast] carrying [code:invited] and the
      //   unknown email in [organisation.sent.list], and [organisation.members.list] holds only
      //   user A's [organisation.members.item]
      await inviteEmail(page, data.unknownEmail)
      await expectMembers(page, [userA.email])
    })

    await test.step('4. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      await inviteEmail(page, userB.email)
      // Expected: After step 4 [organisation.sent.list] holds both emails, each
      //   [organisation.sent.item] with [organisation.sent.copy-button] and
      //   [organisation.sent.revoke-button], and [organisation.members.list] still holds only
      //   user A's [organisation.members.item]
      await expect(sentItems(page)).toHaveCount(2)

      for (const email of [data.unknownEmail, userB.email]) {
        const item = sentItems(page).filter({ hasText: email })

        await expect(item).toHaveCount(1)
        await expect(item.getByTestId('organisation.sent.copy-button')).toBeVisible()
        await expect(item.getByTestId('organisation.sent.revoke-button')).toBeVisible()
      }

      await expectMembers(page, [userA.email])
    })

    await test.step("5. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await acceptOnOrg(deviceB, data.name)
      // Expected: After step 5 device B shows the organisation name in
      //   [organisation.page.heading], [organisation.page.role-badge] carrying [value:member],
      //   [organisation.notes.section] in [state:empty] with [organisation.notes.new-textarea]
      //   and [organisation.notes.add-button], and [organisation.create.toggle-button]
      await expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(data.name)
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      const section = deviceB.getByTestId('organisation.notes.section')

      await expect(section).toHaveAttribute('data-state', 'empty')
      await expect(section.getByTestId('organisation.notes.new-textarea')).toBeVisible()
      await expect(section.getByTestId('organisation.notes.add-button')).toBeVisible()
      await expect(deviceB.getByTestId('organisation.create.toggle-button')).toBeVisible()
    })

    // Expected:
    // - Device B shows no [organisation.members.list], no [organisation.invite.form], no
    //   [organisation.sent.list] and no [organisation.page.status]
    await expect(deviceB.getByTestId('organisation.members.list')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.invite.form')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.sent.list')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.page.status')).toHaveCount(0)
  })
})
