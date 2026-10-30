// scenario: organisation/base/member-page
import { generate } from '../../support/data'
import { expect, signUp, test } from '../../support/fixtures'
import { createOrganisation, expectInvited } from '../../support/organisation'

test.describe('Open the organisation page as a member', { tag: '@smoke' }, () => {
  test('An administrator invites an account, which then sees the organisation as a member, without its members or the invitation', async ({
    page,
    anotherAccount,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      unknownEmail: generate.email(),
    }
    const userB = anotherAccount.account
    const members = page
      .getByTestId('organisation.members.list')
      .getByTestId('organisation.members.item')

    const deviceB =
      await test.step('1. On device B, sign up as user B and wait for [/me]', async () => {
        const b = await anotherAccount.signUp()

        await expect(b.getByTestId('user.profile.heading')).toHaveText(userB.name)

        return b
      })

    const userA =
      await test.step('2. On device A, sign up as user A, open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)
        await expect(members).toHaveText([account.email])

        return account
      })

    await test.step('3. On device A, enter the unknown email into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      await page.getByTestId('organisation.invite.email-input').fill(data.unknownEmail)
      await page.getByTestId('organisation.invite.submit-button').click()
      // Expected: After step 3 device A shows [organisation.invite.error] carrying
      //   [code:no-such-identity], and [organisation.members.list] holds only user A's
      //   [organisation.members.item]
      await expect(page.getByTestId('organisation.invite.error')).toHaveAttribute(
        'data-code',
        'no-such-identity',
      )
      await expect(members).toHaveText([userA.email])
    })

    await test.step('4. On device A, clear [organisation.invite.email-input], enter the email of user B into it and click [organisation.invite.submit-button]', async () => {
      await page.getByTestId('organisation.invite.email-input').clear()
      await page.getByTestId('organisation.invite.email-input').fill(userB.email)
      await page.getByTestId('organisation.invite.submit-button').click()
      // Expected: After step 4 device A shows [app-shell.toast] carrying [code:invited] and user
      //   B's [organisation.members.item] in [organisation.members.list], with
      //   [organisation.members.remove-button]
      await expectInvited(page, userB.email)
      await expect(
        members.filter({ hasText: userB.email }).getByTestId('organisation.members.remove-button'),
      ).toBeVisible()
    })

    await test.step('5. On device B, open [/org]', async () => {
      await deviceB.getByTestId('app-shell.nav.organisation-link').click()
      // Expected: After step 5 device B shows the organisation name in
      //   [organisation.page.heading], [organisation.page.role-badge] carrying [value:member],
      //   [organisation.notes.section] in [state:empty] with [organisation.notes.new-textarea]
      //   and [organisation.notes.add-button], and [organisation.create.toggle-button]
      await expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
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
    // - Device B shows no [organisation.members.list], no [organisation.invite.form] and no
    //   [organisation.page.status]
    await expect(deviceB.getByTestId('organisation.members.list')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.invite.form')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.page.status')).toHaveCount(0)
  })
})
