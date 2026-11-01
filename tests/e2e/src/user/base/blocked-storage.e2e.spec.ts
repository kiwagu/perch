// scenario: user/base/blocked-storage
import { expect, test } from '../../support/fixtures'

test.describe('Open the app in a browser that blocks site data', { tag: '@smoke' }, () => {
  test('A browser that keeps no site data is told so instead of being sent to sign-in again and again', async ({
    page,
  }) => {
    await test.step('1. Make the browser refuse the page its localStorage, as when site data is blocked', async () => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('access is denied for this document', 'SecurityError')
          },
        })
      })
    })

    await test.step('2. Open [/sign-in]', async () => {
      await page.goto('/sign-in')
    })

    // Expected:
    // - After step 2 [app-shell.status] is in [state:storage-blocked]: the page says that this
    //   browser does not let Perch keep data on this device, and to allow site data for this site,
    //   then reload the page
    await expect(page.getByTestId('app-shell.status')).toHaveAttribute(
      'data-state',
      'storage-blocked',
    )
    await expect(page.getByTestId('app-shell.status')).toBeVisible()
    // - The page shows no [user.sign-in.form]
    await expect(page.getByTestId('user.sign-in.form')).toHaveCount(0)
  })
})
