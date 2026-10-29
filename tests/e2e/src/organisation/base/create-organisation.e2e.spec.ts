// scenario: organisation/base/create-organisation
import { generate } from '../../support/data'
import { appReady, expect, signUp, test, toast } from '../../support/fixtures'

test.describe('Create the first organisation', { tag: '@smoke' }, () => {
  test('An account that belongs to no organisation creates one and administers it', async ({
    page,
  }) => {
    const data = {
      invalidKey: 'Not a key',
      key: generate.tenantKey(),
      name: generate.organisationName(),
    }

    await test.step('1. Sign up, open [/org] and wait for [organisation.page.status] to reach [state:empty]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation-link').click()
      // The gateway's welcome, with the account's memberships (none), has arrived once the sync
      // channel is up.
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
      await expect(page.getByTestId('organisation.page.status')).toHaveAttribute(
        'data-state',
        'empty',
      )
      // Expected: After step 1 [organisation.create.form] shows, with no
      //   [organisation.create.toggle-button], no [organisation.page.heading] and no
      //   [organisation.notes.section]
      await expect(page.getByTestId('organisation.create.form')).toBeVisible()
      await expect(page.getByTestId('organisation.create.toggle-button')).toHaveCount(0)
      await expect(page.getByTestId('organisation.page.heading')).toHaveCount(0)
      await expect(page.getByTestId('organisation.notes.section')).toHaveCount(0)
    })

    await test.step('2. Enter the invalid key and the organisation name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
      await page.getByTestId('organisation.create.key-input').fill(data.invalidKey)
      await page.getByTestId('organisation.create.name-input').fill(data.name)
      await page.getByTestId('organisation.create.submit-button').click()
      // Expected: After step 2 [organisation.create.error] carries [code:key-invalid],
      //   [organisation.page.status] is still in [state:empty] and
      //   [organisation.create.name-input] keeps the organisation name
      await expect(page.getByTestId('organisation.create.error')).toHaveAttribute(
        'data-code',
        'key-invalid',
      )
      await expect(page.getByTestId('organisation.page.status')).toHaveAttribute(
        'data-state',
        'empty',
      )
      await expect(page.getByTestId('organisation.create.name-input')).toHaveValue(data.name)
    })

    await test.step('3. Clear [organisation.create.key-input], enter the organisation key into it and click [organisation.create.submit-button]', async () => {
      await page.getByTestId('organisation.create.key-input').clear()
      await page.getByTestId('organisation.create.key-input').fill(data.key)
      await page.getByTestId('organisation.create.submit-button').click()
      // Expected: After step 3 [app-shell.toast] carries [code:organisation-created],
      //   [organisation.page.heading] shows the organisation name, [organisation.page.role-badge]
      //   carries [value:admin] and no [organisation.page.status] shows
      await expect(toast(page, 'organisation-created')).toBeVisible()
      await expect(page.getByTestId('organisation.page.heading')).toHaveText(data.name)
      await expect(page.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'admin',
      )
      await expect(page.getByTestId('organisation.page.status')).toHaveCount(0)
    })

    // Expected:
    // - After step 3 [organisation.notes.section] reaches [state:empty] with
    //   [organisation.notes.empty-message] carrying [code:no-notes], [organisation.members.list]
    //   holds one [organisation.members.item], the account's own, without
    //   [organisation.members.remove-button], and [organisation.invite.form] shows
    await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
      'data-state',
      'empty',
    )
    await expect(page.getByTestId('organisation.notes.empty-message')).toHaveAttribute(
      'data-code',
      'no-notes',
    )
    const members = page
      .getByTestId('organisation.members.list')
      .getByTestId('organisation.members.item')

    await expect(members).toHaveCount(1)
    await expect(members.getByTestId('organisation.members.remove-button')).toHaveCount(0)
    await expect(page.getByTestId('organisation.invite.form')).toBeVisible()
    // - After step 3 [organisation.create.form] is closed behind
    //   [organisation.create.toggle-button], and no [organisation.page.current-select] shows for
    //   one organisation
    await expect(page.getByTestId('organisation.create.form')).toBeHidden()
    await expect(page.getByTestId('organisation.create.toggle-button')).toBeVisible()
    await expect(page.getByTestId('organisation.page.current-select')).toHaveCount(0)

    await test.step('4. Reload the page and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 4 [organisation.page.heading] shows the organisation name,
      //   [organisation.page.role-badge] carries [value:admin] and [organisation.notes.section]
      //   is in [state:empty]
      await expect(page.getByTestId('organisation.page.heading')).toHaveText(data.name)
      await expect(page.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'admin',
      )
      await expect(page.getByTestId('organisation.notes.section')).toHaveAttribute(
        'data-state',
        'empty',
      )
    })
  })
})
