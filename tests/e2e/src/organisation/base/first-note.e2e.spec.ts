// scenario: organisation/base/first-note
import { generate } from '../../support/data'
import { appReady, expect, signUp, test, toast } from '../../support/fixtures'
import { createOrganisation } from '../../support/organisation'

test.describe('Add the first note', { tag: '@smoke' }, () => {
  test('An administrator adds the first note of a new organisation and sees it as its own', async ({
    page,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      note: generate.noteText(),
    }
    const notes = page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.item')

    await test.step('1. Sign up, open the link of [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation-link').click()
      await createOrganisation(page, data)
      await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'empty',
      )
    })

    await test.step('2. Click [organisation.notes.add-button] with [organisation.notes.new-textarea] empty', async () => {
      await expect(page.getByTestId('organisation.notes.new-textarea')).toHaveValue('')
      await page.getByTestId('organisation.notes.add-button').click()
      // Expected: After step 2 [organisation.notes.error] carries [code:text-required] and
      //   [organisation.notes.section] is still in [state:empty]
      await expect(page.getByTestId('organisation.notes.error')).toHaveAttribute(
        'data-code',
        'text-required',
      )
      await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'empty',
      )
    })

    await test.step('3. Enter the note into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
      await page.getByTestId('organisation.notes.new-textarea').fill(data.note)
      await page.getByTestId('organisation.notes.add-button').click()
      // Expected: After step 3 [app-shell.toast] carries [code:note-created],
      //   [organisation.notes.new-textarea] is empty and [organisation.notes.section] is in
      //   [state:ready], with no [organisation.notes.empty-message]
      await expect(toast(page, 'note-created')).toBeVisible()
      await expect(page.getByTestId('organisation.notes.new-textarea')).toHaveValue('')
      await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.getByTestId('organisation.notes.empty-message')).toHaveCount(0)
    })

    // Expected:
    // - After step 3 [organisation.notes.list] holds one [organisation.notes.item]: its
    //   [organisation.notes.text-cell] shows the note, with [organisation.notes.mine-badge],
    //   [organisation.notes.edit-button] and [organisation.notes.delete-button]
    await expect(notes).toHaveCount(1)
    await expect(notes.getByTestId('organisation.notes.text-cell')).toHaveText(data.note)
    await expect(notes.getByTestId('organisation.notes.mine-badge')).toBeVisible()
    await expect(notes.getByTestId('organisation.notes.edit-button')).toBeVisible()
    await expect(notes.getByTestId('organisation.notes.delete-button')).toBeVisible()

    await test.step('4. Reload the page and wait for [organisation.notes.section] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
      await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'ready',
      )
      // Expected: After step 4 [organisation.notes.list] still holds the one note
      await expect(notes.getByTestId('organisation.notes.text-cell')).toHaveText([data.note])
    })
  })
})
