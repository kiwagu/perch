// scenario: organisation/flows/role-change
import { generate } from '../../support/data'
import { appReady, expect, pageLoads, signUp, test, toast } from '../../support/fixtures'
import {
  acceptOnOrg,
  chooseMemberRole,
  createOrganisation,
  expectMembers,
  inviteEmail,
  memberItem,
  memberRoleOption,
  noteItem,
} from '../../support/organisation'

test.describe('Promote and demote a member', { tag: '@full' }, () => {
  test('A promoted member becomes an administrator on its device without a reload, and its next change is judged by the new role; the new administrator demotes the first, and the last administrator cannot demote itself', async ({
    page,
    anotherAccount,
  }, testInfo) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
    }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', () =>
        anotherAccount.signUp())

    const userA =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], create the organisation with [organisation.create.submit-button], enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)
        await page.getByTestId('organisation.notes.new-textarea').fill(data.noteByA)
        await page.getByTestId('organisation.notes.add-button').click()
        await expect(
          page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
        ).toHaveText([data.noteByA])

        return account
      })

    await test.step('3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      await inviteEmail(page, userB.email)
    })

    // Full page loads of device B from step 4: its role changes must reach it without one.
    const loadsOfB = pageLoads(deviceB)

    await test.step("4. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await acceptOnOrg(deviceB, data.name)
      // Expected: After step 4 device B shows the note by A without
      //   [organisation.notes.delete-button], and no [organisation.members.list]
      await expect(noteItem(deviceB, data.noteByA)).toBeVisible()
      await expect(
        noteItem(deviceB, data.noteByA).getByTestId('organisation.notes.delete-button'),
      ).toHaveCount(0)
      await expect(deviceB.getByTestId('organisation.members.list')).toHaveCount(0)
    })

    await test.step("5. On device A, reload [/org] and, on user B's [organisation.members.item], set [organisation.members.role-select] to [value:admin]", async () => {
      await page.reload()
      await appReady(page)
      await memberItem(page, userB.email).getByTestId('organisation.members.role-select').click()

      // When device B shows the administrator's page, read on the clock both browsers share.
      const shownAt = deviceB
        .waitForFunction(
          ({ note }) =>
            document
              .querySelector('[data-testid="organisation.page.role-badge"]')
              ?.getAttribute('data-value') === 'admin' &&
            document.querySelectorAll(
              '[data-testid="organisation.members.list"] [data-testid="organisation.members.item"]',
            ).length === 2 &&
            Array.from(document.querySelectorAll('[data-testid="organisation.notes.item"]')).some(
              (item) =>
                item.textContent?.includes(note) &&
                item.querySelector('[data-testid="organisation.notes.delete-button"]') !== null,
            ) &&
            Date.now(),
          { note: data.noteByA },
          { polling: 'raf', timeout: 5_000 },
        )
        .then((handle) => handle.jsonValue())

      // Awaited after the assertions below, which report a timeout better.
      shownAt.catch(() => undefined)

      const chosenAt = Date.now()

      await memberRoleOption(page, 'admin').click()
      // Expected: After step 5 [app-shell.toast] carries [code:role-changed] on device A
      await expect(toast(page, 'role-changed')).toBeVisible()
      // Expected: Within 5 seconds of step 5 device B shows [organisation.page.role-badge]
      //   carrying [value:admin], [organisation.members.list] with both members and
      //   [organisation.notes.delete-button] on the note by A, without a reload; the delay is
      //   reported as "role-change-ms"
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'admin',
        { timeout: 5_000 },
      )
      await expectMembers(deviceB, [userA.email, userB.email])
      await expect(
        noteItem(deviceB, data.noteByA).getByTestId('organisation.notes.delete-button'),
      ).toBeVisible()
      expect(loadsOfB(), 'pages device B loaded since step 4').toBe(0)

      const shown = await shownAt
      const latency = typeof shown === 'number' ? shown - chosenAt : Number.NaN

      expect(latency, 'the delay from the role change to device B').toBeGreaterThanOrEqual(0)
      expect(latency, 'the delay from the role change to device B').toBeLessThanOrEqual(5_000)
      testInfo.annotations.push({ type: 'role-change-ms', description: String(latency) })
    })

    await test.step('6. On device B, click [organisation.notes.delete-button] on the note by A and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await noteItem(deviceB, data.noteByA).getByTestId('organisation.notes.delete-button').click()
      await deviceB.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: Within 5 seconds of step 6 device A no longer shows the note by A, without a
      //   reload
      await expect(noteItem(page, data.noteByA)).toHaveCount(0, { timeout: 5_000 })
    })

    await test.step("7. On device B, on user A's [organisation.members.item], set [organisation.members.role-select] to [value:member]", async () => {
      await chooseMemberRole(deviceB, userA.email, 'member')
      // Expected: Within 5 seconds of step 7 device A shows [organisation.page.role-badge]
      //   carrying [value:member], and no [organisation.members.list] and no
      //   [organisation.invite.form], without a reload
      await expect(page.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
        { timeout: 5_000 },
      )
      await expect(page.getByTestId('organisation.members.list')).toHaveCount(0)
      await expect(page.getByTestId('organisation.invite.form')).toHaveCount(0)
    })

    await test.step('8. On device B, on its own [organisation.members.item], set [organisation.members.role-select] to [value:member]', async () => {
      await chooseMemberRole(deviceB, userB.email, 'member')
      // Expected: After step 8 [organisation.invite.error] carries [code:last-admin] on device B,
      //   and its own [organisation.members.item] has [organisation.members.role-select] showing
      //   [value:admin]
      await expect(deviceB.getByTestId('organisation.invite.error')).toHaveAttribute(
        'data-code',
        'last-admin',
      )
      await expect(
        memberItem(deviceB, userB.email).getByTestId('organisation.members.role-select'),
      ).toHaveAttribute('data-value', 'admin')
    })

    // Expected:
    // - Device B loaded no page since step 4
    expect(loadsOfB(), 'pages device B loaded since step 4').toBe(0)
  })
})
