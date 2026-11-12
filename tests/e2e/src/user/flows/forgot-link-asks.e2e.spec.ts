// scenario: user/flows/forgot-link-asks
import type { Page } from '@playwright/test'

import { generate } from '../../support/data'
import { appReady, expect, test } from '../../support/fixtures'

/** The frame's leave dialog, by its anchor and its code together. */
const dialog = (page: Page) =>
  page.locator('[data-testid="app-shell.leave-dialog"][data-code="unsaved-input"]')

test.describe('Leave the sign-in form by its forgot-password link', { tag: '@full' }, () => {
  test('A guest who typed a password is asked before the link loses it, while the email it carries asks nothing', async ({
    page,
  }) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
    }
    const email = page.getByTestId('user.sign-in.email-input')
    const password = page.getByTestId('user.sign-in.password-input')
    const forgot = page.getByTestId('user.sign-in.forgot-link')
    const resetEmail = page.getByTestId('user.forgot-password.email-input')

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
    })

    await test.step('2. Enter the email into [user.sign-in.email-input] and the password into [user.sign-in.password-input]', async () => {
      await email.fill(data.email)
      await password.fill(data.password)
    })

    await test.step('3. Click [user.sign-in.forgot-link]', async () => {
      await forgot.click()
    })

    // - After step 3 [app-shell.leave-dialog] carries [code:unsaved-input] and the page stays on [/sign-in]
    await expect(dialog(page)).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in(\?.*)?$/)

    await test.step('4. Click [app-shell.leave-dialog.cancel-button]', async () => {
      await page.getByTestId('app-shell.leave-dialog.cancel-button').click()
    })

    // - After step 4 [user.sign-in.password-input] still holds the password, and no [app-shell.leave-dialog] is shown
    await expect(dialog(page)).toBeHidden()
    await expect(password).toHaveValue(data.password)

    await test.step('5. Click [user.sign-in.forgot-link]', async () => {
      await forgot.click()
      await expect(dialog(page)).toBeVisible()
    })

    await test.step('6. Click [app-shell.leave-dialog.confirm-button]', async () => {
      await page.getByTestId('app-shell.leave-dialog.confirm-button').click()
    })

    // - After step 6 the page is on [/forgot-password] and [user.forgot-password.email-input] shows the email
    await expect(page).toHaveURL(/\/forgot-password(\?.*)?$/)
    await expect(resetEmail).toHaveValue(data.email)

    await test.step('7. Open [/sign-in], wait for [app-shell.status] to reach [state:ready], enter the email into [user.sign-in.email-input] and click [user.sign-in.forgot-link]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
      await email.fill(data.email)
      await forgot.click()
    })

    // - After step 7 the page is on [/forgot-password] without [app-shell.leave-dialog] having been shown, and [user.forgot-password.email-input] shows the email
    await expect(page).toHaveURL(/\/forgot-password(\?.*)?$/)
    await expect(dialog(page)).toHaveCount(0)
    await expect(resetEmail).toHaveValue(data.email)
  })
})
