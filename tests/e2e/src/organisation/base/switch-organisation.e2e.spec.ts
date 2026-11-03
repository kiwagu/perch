// scenario: organisation/base/switch-organisation
import { generate } from '../../support/data'
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { createOrganisation } from '../../support/organisation'

test.describe('Create a second organisation and switch between them', { tag: '@smoke' }, () => {
  test('An administrator of one organisation creates a second one, which becomes current, and chooses the first one again', async ({
    page,
  }) => {
    const data = {
      firstKey: generate.tenantKey(),
      firstName: generate.organisationName(),
      note: generate.noteText(),
      secondKey: generate.tenantKey(),
      secondName: generate.organisationName(),
    }
    const select = page.getByTestId('organisation.page.current-select')
    const options = page.getByTestId('organisation.page.current-select.option')
    const noteTexts = page
      .getByTestId('organisation.notes.list')
      .getByTestId('organisation.notes.text-cell')

    await test.step('1. Sign up, open the link of [mail:sign-up], open [/org], enter the first key and name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation-link').click()
      await createOrganisation(page, { key: data.firstKey, name: data.firstName })
    })

    await test.step('2. Enter the note into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
      await page.getByTestId('organisation.notes.new-textarea').fill(data.note)
      await page.getByTestId('organisation.notes.add-button').click()
      await expect(noteTexts).toHaveText([data.note])
    })

    await test.step('3. Click [organisation.create.toggle-button], enter the second key and name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
      await page.getByTestId('organisation.create.toggle-button').click()
      await expect(page.getByTestId('organisation.create.form')).toBeVisible()
      // Expected: After step 3 [organisation.page.heading] shows the second name,
      //   [organisation.page.role-badge] carries [value:admin], [organisation.notes.section]
      //   reaches [state:empty] and [organisation.create.form] is closed again
      await createOrganisation(page, { key: data.secondKey, name: data.secondName })
      await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'empty',
      )
      await expect(page.getByTestId('organisation.create.form')).toBeHidden()
    })

    // Expected:
    // - After step 3 [organisation.page.current-select] shows two
    //   [organisation.page.current-select.option], one per key
    await expect(select).toHaveAttribute('data-value', data.secondKey)
    await select.click()
    await expect(options).toHaveCount(2)
    await expect(options.and(page.locator(`[data-value="${data.firstKey}"]`))).toHaveCount(1)
    await expect(options.and(page.locator(`[data-value="${data.secondKey}"]`))).toHaveCount(1)

    await test.step('4. Choose the option of the first key in [organisation.page.current-select]', async () => {
      await options.and(page.locator(`[data-value="${data.firstKey}"]`)).click()
      // Expected: After step 4 [organisation.page.heading] shows the first name and
      //   [organisation.notes.list] holds the note
      await expect(page.getByTestId('organisation.page.heading')).toHaveText(data.firstName)
      await expect(select).toHaveAttribute('data-value', data.firstKey)
      await expect(noteTexts).toHaveText([data.note])
    })

    await test.step('5. Reload the page and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 5 the first organisation is still current:
      //   [organisation.page.heading] shows the first name
      await expect(page.getByTestId('organisation.page.heading')).toHaveText(data.firstName)
      await expect(select).toHaveAttribute('data-value', data.firstKey)
    })
  })
})
