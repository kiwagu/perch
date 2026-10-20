// spec: tests/e2e/specs/user/03-blocked-storage.md
import { expect, test } from '../support/fixtures'

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

    await test.step('2. Open "/sign-in"', async () => {
      await page.goto('/sign-in')
    })

    // Expected:
    // - After step 2 the page says that the browser keeps no data for it
    await expect(page.getByTestId('app-shell.opening')).toHaveText(
      'This browser does not let Perch keep data on this device. Allow site data for this site, then reload the page.',
    )
    // - The page shows no sign-in form
    await expect(page.getByTestId('user.sign-in.email')).toHaveCount(0)
  })
})
