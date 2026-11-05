// scenario: organisation/flows/outsider
import { generate } from '../../support/data'
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { createOrganisation } from '../../support/organisation'

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

    await test.step('1. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], create the organisation with [organisation.create.submit-button] and add the note by A with [organisation.notes.add-button]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation-link').click()
      await createOrganisation(page, data)
      await page.getByTestId('organisation.notes.new-textarea').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add-button').click()
      await expect(
        page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA])
    })

    const deviceC =
      await test.step('2. On device C, sign up as user C, open the link of its [mail:sign-up] and open [/org]', async () => {
        const c = await anotherAccount.signUp()

        await c.getByTestId('app-shell.nav.organisation-link').click()
        // The gateway's welcome, with the memberships it gives user C, has arrived once the
        // sync channel is up.
        await expect(c.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })
        // Expected: After step 2 device C shows [organisation.page.status] in [state:empty] (not a
        //   member of any organisation yet) and no [organisation.notes.item]
        await expect(c.getByTestId('organisation.page.status')).toHaveAttribute(
          'data-state',
          'empty',
        )
        await expect(c.getByTestId('organisation.notes.item')).toHaveCount(0)

        return c
      })

    await test.step("3. On device C, create C's own organisation with [organisation.create.submit-button]", async () => {
      // Expected: After step 3 device C shows C's organisation in [organisation.page.heading] with
      //   no [organisation.notes.item], and no [organisation.page.current-select] for another
      //   organisation
      await createOrganisation(deviceC, { key: data.keyOfC, name: data.nameOfC })
      // The notes of C's organisation have been read: the notes section says there are none.
      await expect(deviceC.getByTestId('organisation.notes.empty-message')).toHaveAttribute(
        'data-code',
        'no-notes',
      )
      await expect(deviceC.getByTestId('organisation.notes.item')).toHaveCount(0)
      await expect(deviceC.getByTestId('organisation.page.current-select')).toHaveCount(0)
    })

    // Expected:
    // - Device A still shows only its own organisation and the note by A in
    //   [organisation.notes.list]
    // Device A reads its memberships from the gateway again, after C's organisation exists: once
    // its sync channel is up it was welcomed with them, and a leak would show here.
    await page.reload()
    await appReady(page)
    await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/org$/)
    await expect(page.getByTestId('organisation.page.heading')).toHaveText(data.name)
    await expect(page.getByTestId('organisation.page.current-select')).toHaveCount(0)
    await expect(
      page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
    ).toHaveText([data.noteByA])
  })
})
