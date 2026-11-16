// scenario: organisation/flows/edit-own-admin-any
import { generate } from '../../support/data'
import { expect, pageLoads, signUp, test } from '../../support/fixtures'
import { acceptOnOrg, createOrganisation, inviteEmail, noteItem } from '../../support/organisation'

test.describe('Edit only your own notes; an administrator edits any', {
  tag: '@full',
}, () => {
  test('A member changes only its own notes, an administrator any, and both see every change', async ({
    page,
    anotherAccount,
  }, testInfo) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
      noteByB: generate.noteText(),
      noteByBEditedByB: generate.noteText(),
      noteByBEditedByA: generate.noteText(),
    }
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', async () => {
        const b = await anotherAccount.signUp()

        await expect(b.getByTestId('user.profile.heading')).toHaveText(userB.name)

        return b
      })
    // Full page loads of device B from here: every change must reach it without one.
    const loadsOfB = pageLoads(deviceB)

    const loadsOfA =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        await signUp(page)
        // Full page loads of device A from here: every change must reach it without one.
        const loads = pageLoads(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)

        return loads
      })

    await test.step('3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      await inviteEmail(page, userB.email)
    })

    await test.step('4. On device A, enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
      await page.getByTestId('organisation.notes.new-textarea').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add-button').click()
      await expect(
        page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA])
    })

    await test.step("5. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await acceptOnOrg(deviceB, data.name)
      await expect(deviceB).toHaveURL(/\/org$/)
      await expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
      await expect(
        deviceB.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA], {
        timeout: 10_000,
      })
      // Expected: After step 5 device B shows the note by A without
      //   [organisation.notes.mine-badge], [organisation.notes.edit-button] or
      //   [organisation.notes.delete-button]
      const noteByA = noteItem(deviceB, data.noteByA)

      await expect(noteByA).toBeVisible()
      await expect(noteByA.getByTestId('organisation.notes.mine-badge')).toHaveCount(0)
      await expect(noteByA.getByTestId('organisation.notes.edit-button')).toHaveCount(0)
      await expect(noteByA.getByTestId('organisation.notes.delete-button')).toHaveCount(0)
    })

    await test.step('6. On device B, enter the note by B into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
      await deviceB.getByTestId('organisation.notes.new-textarea').fill(data.noteByB)
      await deviceB.getByTestId('organisation.notes.add-button').click()
      // Expected: After step 6 device B shows the note by B with [organisation.notes.mine-badge],
      //   [organisation.notes.edit-button] and [organisation.notes.delete-button]
      const noteByB = noteItem(deviceB, data.noteByB)

      await expect(noteByB).toBeVisible()
      await expect(noteByB.getByTestId('organisation.notes.mine-badge')).toBeVisible()
      await expect(noteByB.getByTestId('organisation.notes.edit-button')).toBeVisible()
      await expect(noteByB.getByTestId('organisation.notes.delete-button')).toBeVisible()
      await expect(
        page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA, data.noteByB], { timeout: 5_000 })
    })

    const measure =
      await test.step('7. On device B, click [organisation.notes.edit-button] on the note by B, enter the note by B edited by B into [organisation.notes.edit-textarea] and click [organisation.notes.save-button]', async () => {
        // When device A shows the edited note by B, read on the clock both browsers share.
        const shownAt = page
          .waitForFunction(
            (text) =>
              Array.from(
                document.querySelectorAll('[data-testid="organisation.notes.text-cell"]'),
              ).some((node) => node.textContent === text) && Date.now(),
            data.noteByBEditedByB,
            { polling: 'raf', timeout: 5_000 },
          )
          .then((handle) => handle.jsonValue())

        // Awaited after the assertion below, which reports a timeout better.
        shownAt.catch(() => undefined)

        await noteItem(deviceB, data.noteByB).getByTestId('organisation.notes.edit-button').click()
        // The note in edit mode no longer shows its text, so its input is the only one.
        await deviceB.getByTestId('organisation.notes.edit-textarea').fill(data.noteByBEditedByB)

        const clickedAt = Date.now()

        await deviceB.getByTestId('organisation.notes.save-button').click()
        await expect(noteItem(deviceB, data.noteByBEditedByB)).toBeVisible()

        return { clickedAt, shownAt }
      })

    // Expected:
    // - Within 5 seconds of step 7 device A shows the note by B edited by B, without a reload; the
    //   delay is reported as "note-edit-sync-latency-ms"
    await expect(
      page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
    ).toHaveText([data.noteByA, data.noteByBEditedByB], { timeout: 5_000 })

    const shownAt = await measure.shownAt
    const latency = typeof shownAt === 'number' ? shownAt - measure.clickedAt : Number.NaN

    expect(
      latency,
      'the delay from the click to the edited note on device A',
    ).toBeGreaterThanOrEqual(0)
    expect(latency, 'the delay from the click to the edited note on device A').toBeLessThanOrEqual(
      5_000,
    )
    testInfo.annotations.push({ type: 'note-edit-sync-latency-ms', description: String(latency) })
    // - Device A shows [organisation.notes.edit-button] and [organisation.notes.delete-button] on
    //   both notes
    for (const text of [data.noteByA, data.noteByBEditedByB]) {
      await expect(noteItem(page, text).getByTestId('organisation.notes.edit-button')).toBeVisible()
      await expect(
        noteItem(page, text).getByTestId('organisation.notes.delete-button'),
      ).toBeVisible()
    }

    await test.step('8. On device A, click [organisation.notes.edit-button] on the note by B, enter the note by B edited by A into [organisation.notes.edit-textarea] and click [organisation.notes.save-button]', async () => {
      await noteItem(page, data.noteByBEditedByB)
        .getByTestId('organisation.notes.edit-button')
        .click()
      await page.getByTestId('organisation.notes.edit-textarea').fill(data.noteByBEditedByA)
      await page.getByTestId('organisation.notes.save-button').click()
      // Expected: Within 5 seconds of step 8 device B shows the note by B edited by A, without a
      //   reload
      await expect(
        deviceB.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA, data.noteByBEditedByA], { timeout: 5_000 })
    })

    await test.step('9. On device B, click [organisation.notes.delete-button] on the note by B and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await noteItem(deviceB, data.noteByBEditedByA)
        .getByTestId('organisation.notes.delete-button')
        .click()
      await deviceB.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: Within 5 seconds of step 9 device A shows only the note by A
      await expect(
        page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA], {
        timeout: 5_000,
      })
    })

    await test.step('10. On device A, click [organisation.notes.delete-button] on the note by A and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await noteItem(page, data.noteByA).getByTestId('organisation.notes.delete-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 10 both devices show [organisation.notes.empty-message]
      await expect(page.getByTestId('organisation.notes.empty-message')).toHaveAttribute(
        'data-code',
        'no-notes',
      )
      await expect(deviceB.getByTestId('organisation.notes.empty-message')).toHaveAttribute(
        'data-code',
        'no-notes',
        { timeout: 5_000 },
      )
    })

    // - Neither device loaded a page since it signed up
    expect(loadsOfA(), 'pages device A loaded since it signed up').toBe(0)
    expect(loadsOfB(), 'pages device B loaded since it signed up').toBe(0)
  })
})
