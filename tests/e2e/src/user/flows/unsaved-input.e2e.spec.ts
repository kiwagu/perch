// scenario: user/flows/unsaved-input
import type { Page } from '@playwright/test'

import { generate } from '../../support/data'
import { appReady, expect, test } from '../../support/fixtures'

/** The frame's leave dialog, by its anchor and its code together. */
const dialog = (page: Page) =>
  page.locator('[data-testid="app-shell.leave-dialog"][data-code="unsaved-input"]')

test.describe('Leave the profile with an unsaved name', { tag: '@full' }, () => {
  test('A signed-in user is asked before an unsaved name is lost, and not when nothing would be lost', async ({
    page,
    signedIn,
  }) => {
    const data = { newName: generate.newName() }
    const name = page.getByTestId('user.profile.name-input')

    await test.step('1. Open [/me] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(name).toHaveValue(signedIn.name)
    })

    await test.step('2. Enter the new name into [user.profile.name-input]', async () => {
      await name.fill(data.newName)
    })

    await test.step('3. Click [app-shell.nav.organisation-link]', async () => {
      await page.getByTestId('app-shell.nav.organisation-link').click()
    })

    // - After step 3 [app-shell.leave-dialog] carries [code:unsaved-input] and the page stays on [/me]
    await expect(dialog(page)).toBeVisible()
    await expect(page).toHaveURL(/\/me$/)

    await test.step('4. Click [app-shell.leave-dialog.cancel-button]', async () => {
      await page.getByTestId('app-shell.leave-dialog.cancel-button').click()
    })

    // - After step 4 [user.profile.name-input] still shows the new name, and no [app-shell.leave-dialog] is shown
    await expect(dialog(page)).toBeHidden()
    await expect(name).toHaveValue(data.newName)

    await test.step('5. Click [app-shell.nav.organisation-link]', async () => {
      await page.getByTestId('app-shell.nav.organisation-link').click()
      await expect(dialog(page)).toBeVisible()
    })

    await test.step('6. Click [app-shell.leave-dialog.confirm-button]', async () => {
      await page.getByTestId('app-shell.leave-dialog.confirm-button').click()
    })

    // - After step 6 the page is on [/org]
    await expect(page).toHaveURL(/\/org$/)

    await test.step('7. Open [/me], enter the new name into [user.profile.name-input], then enter the stored name back', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expect(name).toHaveValue(signedIn.name)
      await name.fill(data.newName)
      await name.fill(signedIn.name)
    })

    await test.step('8. Click [app-shell.nav.organisation-link]', async () => {
      await page.getByTestId('app-shell.nav.organisation-link').click()
    })

    // - After step 8 the page is on [/org] without [app-shell.leave-dialog] having been shown
    await expect(page).toHaveURL(/\/org$/)
    await expect(dialog(page)).toHaveCount(0)

    await test.step("9. Open [/me], enter the new name into [user.profile.name-input] and reload the page, accepting the browser's prompt", async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expect(name).toHaveValue(signedIn.name)
      await name.fill(data.newName)

      const prompted = new Promise<string>((resolve) => {
        page.once('dialog', (prompt) => {
          resolve(prompt.type())
          void prompt.accept()
        })
      })

      await page.reload()
      // - At step 9 the browser's own prompt is shown before the reload; after it [user.profile.name-input] shows the stored name
      expect(await prompted).toBe('beforeunload')
      await appReady(page)
      await expect(name).toHaveValue(signedIn.name)
    })
  })
})
