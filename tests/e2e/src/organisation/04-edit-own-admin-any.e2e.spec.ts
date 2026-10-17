// spec: tests/e2e/specs/organisation/04-edit-own-admin-any.md
import type { Page } from '@playwright/test'

import { generate } from '../support/data'
import { expect, pageLoads, signUp, test } from '../support/fixtures'

const noteItem = (device: Page, text: string) =>
  device.getByTestId('organisation.notes.item').filter({ hasText: text })

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
      await test.step('1. On device B, sign up as user B and wait for "/me"', async () => {
        const b = await anotherAccount.signUp()

        await expect(b.getByTestId('user.profile.heading')).toHaveText(userB.name)

        return b
      })
    // Full page loads of device B from here: every change must reach it without one.
    const loadsOfB = pageLoads(deviceB)

    const loadsOfA =
      await test.step('2. On device A, sign up as user A, open "/org", enter the key and the name and click "Create"', async () => {
        await signUp(page)
        // Full page loads of device A from here: every change must reach it without one.
        const loads = pageLoads(page)

        await page.getByTestId('app-shell.nav.organisation').click()
        await page.getByTestId('organisation.create.key').fill(data.key)
        await page.getByTestId('organisation.create.name').fill(data.name)
        await page.getByTestId('organisation.create.submit').click()
        await expect(page.getByTestId('organisation.heading')).toHaveText(data.name)
        await expect(page.getByTestId('organisation.role')).toHaveText('Administrator')

        return loads
      })

    await test.step('3. On device A, enter the email of user B and click "Invite"', async () => {
      await page.getByTestId('organisation.invite.email').fill(userB.email)
      await page.getByTestId('organisation.invite.submit').click()
      await expect(page.getByTestId('organisation.invite.notice')).toHaveText('Invited')
      await expect(
        page.getByTestId('organisation.members.item').filter({ hasText: userB.email }),
      ).toBeVisible()
    })

    await test.step('4. On device A, enter the note by A and click "Add note"', async () => {
      await page.getByTestId('organisation.notes.input').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add').click()
      await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])
    })

    await test.step('5. On device B, open "/org"', async () => {
      await deviceB.getByTestId('app-shell.nav.organisation').click()
      await expect(deviceB).toHaveURL(/\/org$/)
      await expect(deviceB.getByTestId('organisation.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
      await expect(deviceB.getByTestId('organisation.notes.text')).toHaveText([data.noteByA], {
        timeout: 10_000,
      })
      // Expected: after step 5 device B shows the note by A without "Yours", "Edit" or "Delete"
      const noteByA = noteItem(deviceB, data.noteByA)

      await expect(noteByA).toBeVisible()
      await expect(noteByA.getByTestId('organisation.notes.mine')).toHaveCount(0)
      await expect(noteByA.getByTestId('organisation.notes.edit')).toHaveCount(0)
      await expect(noteByA.getByTestId('organisation.notes.delete')).toHaveCount(0)
    })

    await test.step('6. On device B, enter the note by B and click "Add note"', async () => {
      await deviceB.getByTestId('organisation.notes.input').fill(data.noteByB)
      await deviceB.getByTestId('organisation.notes.add').click()
      // Expected: after step 6 device B shows the note by B with "Yours", "Edit" and "Delete"
      const noteByB = noteItem(deviceB, data.noteByB)

      await expect(noteByB).toBeVisible()
      await expect(noteByB.getByTestId('organisation.notes.mine')).toBeVisible()
      await expect(noteByB.getByTestId('organisation.notes.edit')).toBeVisible()
      await expect(noteByB.getByTestId('organisation.notes.delete')).toBeVisible()
      await expect(page.getByTestId('organisation.notes.text')).toHaveText(
        [data.noteByA, data.noteByB],
        { timeout: 5_000 },
      )
    })

    const measure =
      await test.step('7. On device B, click "Edit" on the note by B, enter the note by B edited by B and click "Save"', async () => {
        // When device A shows the edited note by B, read on the clock both browsers share.
        const shownAt = page
          .waitForFunction(
            (text) =>
              Array.from(document.querySelectorAll('[data-testid="organisation.notes.text"]')).some(
                (node) => node.textContent === text,
              ) && Date.now(),
            data.noteByBEditedByB,
            { polling: 'raf', timeout: 5_000 },
          )
          .then((handle) => handle.jsonValue())

        // Awaited after the assertion below, which reports a timeout better.
        shownAt.catch(() => undefined)

        await noteItem(deviceB, data.noteByB).getByTestId('organisation.notes.edit').click()
        // The note in edit mode no longer shows its text, so its input is the only one.
        await deviceB.getByTestId('organisation.notes.edit-input').fill(data.noteByBEditedByB)

        const clickedAt = Date.now()

        await deviceB.getByTestId('organisation.notes.save').click()
        await expect(noteItem(deviceB, data.noteByBEditedByB)).toBeVisible()

        return { clickedAt, shownAt }
      })

    // Expected:
    // - Within 5 seconds of step 7 device A shows the note by B edited by B, without a reload; the delay is reported as "note-edit-sync-latency-ms"
    await expect(page.getByTestId('organisation.notes.text')).toHaveText(
      [data.noteByA, data.noteByBEditedByB],
      { timeout: 5_000 },
    )

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
    // - Device A shows "Edit" and "Delete" on both notes
    for (const text of [data.noteByA, data.noteByBEditedByB]) {
      await expect(noteItem(page, text).getByTestId('organisation.notes.edit')).toBeVisible()
      await expect(noteItem(page, text).getByTestId('organisation.notes.delete')).toBeVisible()
    }

    await test.step('8. On device A, click "Edit" on the note by B, enter the note by B edited by A and click "Save"', async () => {
      await noteItem(page, data.noteByBEditedByB).getByTestId('organisation.notes.edit').click()
      await page.getByTestId('organisation.notes.edit-input').fill(data.noteByBEditedByA)
      await page.getByTestId('organisation.notes.save').click()
      // Expected: within 5 seconds of step 8 device B shows the note by B edited by A, without a reload
      await expect(deviceB.getByTestId('organisation.notes.text')).toHaveText(
        [data.noteByA, data.noteByBEditedByA],
        { timeout: 5_000 },
      )
    })

    await test.step('9. On device B, click "Delete" on the note by B', async () => {
      await noteItem(deviceB, data.noteByBEditedByA)
        .getByTestId('organisation.notes.delete')
        .click()
      // Expected: within 5 seconds of step 9 device A shows only the note by A
      await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA], {
        timeout: 5_000,
      })
    })

    await test.step('10. On device A, click "Delete" on the note by A', async () => {
      await noteItem(page, data.noteByA).getByTestId('organisation.notes.delete').click()
      // Expected: after step 10 both devices show "No notes yet."
      await expect(page.getByText('No notes yet.')).toBeVisible()
      await expect(deviceB.getByText('No notes yet.')).toBeVisible({ timeout: 5_000 })
    })

    // - Neither device loaded a page since it signed up
    expect(loadsOfA(), 'pages device A loaded since it signed up').toBe(0)
    expect(loadsOfB(), 'pages device B loaded since it signed up').toBe(0)
  })
})
