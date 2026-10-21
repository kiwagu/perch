// scenario: organisation/02-outsider
import { generate } from '../support/data'
import { appReady, expect, signUp, test } from '../support/fixtures'
import { createOrganisation } from '../support/organisation'

test.describe('Keep an organisation invisible to accounts outside it', { tag: '@full' }, () => {
  test('An account that was not invited sees no organisation and no notes', async ({
    page,
    anotherAccount,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
      keyOfC: generate.tenantKey(),
      nameOfC: generate.organisationName(),
    }

    await test.step('1. On device A, sign up as user A, open "/org", create the organisation and add the note by A', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation').click()
      await createOrganisation(page, data)
      await page.getByTestId('organisation.notes.input').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add').click()
      await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])
    })

    const deviceC =
      await test.step('2. On device C, sign up as user C and open "/org"', async () => {
        const c = await anotherAccount.signUp()

        await c.getByTestId('app-shell.nav.organisation').click()
        // The gateway's welcome, with the memberships it gives user C, has arrived once the
        // sync channel is up.
        await expect(c.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })
        // Expected: after step 2 device C shows "You are not a member of any organisation yet."
        // and no notes
        await expect(c.getByTestId('organisation.none')).toHaveText(
          'You are not a member of any organisation yet.',
        )
        await expect(c.getByTestId('organisation.notes.item')).toHaveCount(0)

        return c
      })

    await test.step("3. On device C, create C's own organisation", async () => {
      // Expected: after step 3 device C shows C's organisation with no notes, and no selector
      // for another organisation
      await createOrganisation(deviceC, { key: data.keyOfC, name: data.nameOfC })
      // The notes of C's organisation have been read: the list says it is empty.
      await expect(deviceC.getByText('No notes yet.')).toBeVisible()
      await expect(deviceC.getByTestId('organisation.notes.item')).toHaveCount(0)
      await expect(deviceC.getByTestId('organisation.select')).toHaveCount(0)
    })

    // Expected:
    // - Device A still shows only its own organisation and the note by A
    // Device A reads its memberships from the gateway again, after C's organisation exists: once
    // its sync channel is up it was welcomed with them, and a leak would show here.
    await page.reload()
    await appReady(page)
    await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/org$/)
    await expect(page.getByTestId('organisation.heading')).toHaveText(data.name)
    await expect(page.getByTestId('organisation.select')).toHaveCount(0)
    await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])
  })
})
