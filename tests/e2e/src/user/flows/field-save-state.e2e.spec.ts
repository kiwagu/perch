// scenario: user/flows/field-save-state
import { generate } from '../../support/data'
import { appReady, expect, test } from '../../support/fixtures'

test.describe("See a field's unsaved and saved states", { tag: '@full' }, () => {
  test('A signed-in user sees a name field unsaved and then saved, and an email field that runs an action only unsaved', async ({
    page,
    signedIn,
  }) => {
    const data = {
      newName: generate.newName(),
      email: generate.email(),
    }
    const name = page.getByTestId('user.profile.name-input')
    const email = page.getByTestId('user.settings.email.email-input')

    await test.step('1. Open [/me] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(name).toHaveValue(signedIn.name)
    })

    await test.step('2. Enter the new name into [user.profile.name-input]', async () => {
      await name.fill(data.newName)
    })

    // - After step 2 [user.profile.name-input] carries [state:unsaved]
    await expect(name).toHaveAttribute('data-state', 'unsaved')

    await test.step('3. Click [user.profile.save-button]', async () => {
      await page.getByTestId('user.profile.save-button').click()
    })

    // - After step 3 [user.profile.name-input] carries [state:saved]
    await expect(name).toHaveAttribute('data-state', 'saved')

    await test.step('4. Reload the page and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
    })

    // - After step 4 [user.profile.name-input] shows the new name and carries no state
    await expect(name).toHaveValue(data.newName)
    await expect(name).not.toHaveAttribute('data-state')

    await test.step('5. Open [/settings] and enter the email into [user.settings.email.email-input]', async () => {
      await page.goto('/settings')
      await appReady(page)
      await email.fill(data.email)
    })

    // - After step 5 [user.settings.email.email-input] carries [state:unsaved]
    await expect(email).toHaveAttribute('data-state', 'unsaved')
  })
})
