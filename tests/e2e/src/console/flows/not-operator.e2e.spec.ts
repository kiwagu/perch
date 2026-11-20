// scenario: console/flows/not-operator
import type { Page } from '@playwright/test'

import { consoleLink, expectAddress } from '../../support/console'
import { generate } from '../../support/data'
import { appReady, expect, signUp, test } from '../../support/fixtures'

/** An address no route takes, where the not-found page is the page of its own. */
const UNKNOWN_ADDRESS = '/no-such-page'

/** Any id of an account, as the search of `/console/account` carries one. */
const ANY_ID = 'idn_01jkq5x3y8z2h9m4n6p7r8s9t0'

/**
 * The title of the not-found page on the device of `page`: read in a tab of the same browser (the
 * same account, the same language) at an address no route takes, once its heading shows, and the
 * tab closed again. The frame names the page in the render that resolved the address, the one
 * that shows the heading; a title read before it would be the app's bare one, which the console's
 * address would then fail to match, never pass.
 */
async function notFoundTitle(page: Page): Promise<string> {
  const tab = await page.context().newPage()

  try {
    await tab.goto(UNKNOWN_ADDRESS)
    await appReady(tab)
    await expect(tab.getByTestId('not-found.page.heading')).toBeVisible()

    return await tab.title()
  } finally {
    await tab.close()
  }
}

test.describe('Open the console without the operator role', { tag: '@smoke' }, () => {
  test("An account without the operator role and a guest each get the not-found page at the console's addresses, which reveal nothing, and the navigation shows no console link", async ({
    page,
    freshDevice,
  }) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, {
        ...generate.account(),
        email: data.email,
        password: data.password,
        name: data.name,
      })
      // Expected: After step 1 [app-shell.nav] on device A shows no [app-shell.nav.console-link]
      // The roles come with the welcome of the device's hello, before its sync channel is up: the
      // link is looked for once they are in.
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
      await expect(page.getByTestId('app-shell.nav')).toBeVisible()
      await expect(consoleLink(page)).toHaveCount(0)
    })

    await test.step('2. On device A, open [/console/users]', async () => {
      await page.goto('/console/users')
      await appReady(page)
      // Expected: After step 2 the address is still [/console/users], [not-found.page.heading]
      //   shows with [not-found.page.profile-link], no [console.users.list] and no
      //   [console.users.search-form] shows, and the page's title is the not-found page's
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expect(page.getByTestId('not-found.page.profile-link')).toBeVisible()
      await expectAddress(page, '/console/users', {})
      await expect(page.getByTestId('console.users.list')).toHaveCount(0)
      await expect(page.getByTestId('console.users.search-form')).toHaveCount(0)
      await expect(page).toHaveTitle(await notFoundTitle(page))
    })

    await test.step('3. On device A, open [/console/account] with any id as its search', async () => {
      await page.goto(`/console/account?${new URLSearchParams({ id: ANY_ID }).toString()}`)
      await appReady(page)
      // Expected: After step 3 the address is still [/console/account] with its search, and
      //   [not-found.page.heading] shows
      await expect(page.getByTestId('not-found.page.heading')).toBeVisible()
      await expectAddress(page, '/console/account', { id: ANY_ID })
    })

    await test.step('4. On device B, open [/console/users]', async () => {
      const deviceB = await freshDevice.open()

      await deviceB.goto('/console/users')
      await appReady(deviceB)
      // Expected: After step 4 the address is still [/console/users] on device B,
      //   [not-found.page.heading] shows with [not-found.page.sign-in-link], and device B is not
      //   sent to [/sign-in]
      await expect(deviceB.getByTestId('not-found.page.heading')).toBeVisible()
      await expect(deviceB.getByTestId('not-found.page.sign-in-link')).toBeVisible()
      // The page shows at the console's address, so device B was not sent to the sign-in page.
      await expectAddress(deviceB, '/console/users', {})
    })
  })
})
