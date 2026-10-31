// scenario: app-shell/base/guest-start
import { holdEngines } from '../../support/engines'
import { appReady, expect, test } from '../../support/fixtures'

test.describe('Open the sign-in page without the database engines', { tag: '@smoke' }, () => {
  test('A guest gets the sign-in form although the database engines cannot load', async ({
    page,
  }) => {
    const engines =
      await test.step("1. Hold back the page's database engines, so that none of them can load", () =>
        holdEngines(page.context()))

    await test.step('2. Open [/sign-in] as a guest', async () => {
      await page.goto('/sign-in', { waitUntil: 'commit' })
    })

    // Expected:
    // - After step 2 [app-shell.status] reaches [state:ready] and [user.sign-in.form] is shown
    await appReady(page)
    await expect(page.getByTestId('user.sign-in.form')).toBeVisible()

    engines.release()
  })
})
