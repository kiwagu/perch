// spec: tests/e2e/specs/user/02-edit-profile-name.md
import { generate } from '../support/data'
import { appReady, expect, test } from '../support/fixtures'

test.describe('Rename yourself on the profile page', { tag: '@smoke' }, () => {
  test('A signed-in user changes their name and keeps it after a reload', async ({
    page,
    signedIn,
  }) => {
    const data = {
      newName: generate.newName(),
    }

    await test.step('1. Open "/me" and wait for the app to be ready', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(signedIn.name)
    })

    await test.step('2. Clear the name', async () => {
      await page.getByTestId('user.profile.name-input').clear()
    })

    await test.step('3. Enter the new name', async () => {
      await page.getByTestId('user.profile.name-input').fill(data.newName)
    })

    await test.step('4. Click "Save"', async () => {
      await page.getByRole('button', { name: 'Save' }).click()
    })

    // Expected:
    // - After step 4 the page shows the notification "Saved"
    await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')
    // - The heading shows the new name
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName)
    // - Reloading the page keeps the new name
    await page.reload()
    await appReady(page)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName)
  })
})
