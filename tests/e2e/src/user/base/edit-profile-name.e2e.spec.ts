// scenario: user/base/edit-profile-name
import { generate } from '../../support/data'
import { appReady, expect, notice, test } from '../../support/fixtures'

test.describe('Rename yourself on the profile page', { tag: '@smoke' }, () => {
  test('A signed-in user changes their name and keeps it after a reload', async ({
    page,
    signedIn,
  }) => {
    const data = {
      newName: generate.newName(),
    }

    await test.step('1. Open [/me] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(signedIn.name)
    })

    await test.step('2. Clear [user.profile.name-input]', async () => {
      await page.getByTestId('user.profile.name-input').clear()
    })

    await test.step('3. Enter the new name into [user.profile.name-input]', async () => {
      await page.getByTestId('user.profile.name-input').fill(data.newName)
    })

    await test.step('4. Click [user.profile.save-button]', async () => {
      await page.getByTestId('user.profile.save-button').click()
    })

    // Expected:
    // - After step 4 [app-shell.notice-message] carries [code:profile-saved]
    await expect(notice(page, 'profile-saved')).toBeVisible()
    // - [user.profile.heading] shows the new name
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName)
    // - Reloading the page keeps the new name
    await page.reload()
    await appReady(page)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName)
  })
})
