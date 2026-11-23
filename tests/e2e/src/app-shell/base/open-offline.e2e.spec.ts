// scenario: app-shell/base/open-offline

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { appReady, expect, signUp, test } from '../../support/fixtures'
import { precachedScript } from '../../support/precache'
import { atRoute } from '../../support/routes'

// The one test that lets the app's service worker run: it opens the app offline.
test.use({ serviceWorkers: 'allow' })

test.describe('Open the app without a network', { tag: '@full' }, () => {
  test('A signed-in device that loaded the app once opens it again offline, with its own data', async ({
    page,
  }) => {
    // The first pull and the account start that step 2 waits for may take up to 30 seconds.
    test.slow()

    // Every address the page requests, from the first load on: the settings' own script must not
    // be among them before the settings open, online or offline.
    const requested: string[] = []

    page.on('request', (request) => {
      requested.push(new URL(request.url()).pathname)
    })

    // The settings' script as the build named it, read from the worker's precache list.
    const settingsChunk = await precachedScript(page, /^\/assets\/settings\.container-[\w-]+\.js$/)

    const account =
      await test.step('1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
        const signedUp = await signUp(page)

        await appReady(page)

        return signedUp
      })

    await test.step('2. Reload the page, wait for [app-shell.status] to reach [state:ready] and for [user.profile.heading] to show the name the account signed up with', async () => {
      await page.reload()
      await appReady(page)
      // The page loaded through the worker, which now holds the shell and the engines' WASM.
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
      // The worker is active: it installed, which waits for its precache to be whole.
      await page.waitForFunction(
        async () =>
          (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
      )
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 15_000,
      })
      // A new account is started (its profile written) only after the device's first pull, so going offline earlier leaves the device without a profile.
      await expect(page.getByTestId('user.profile.heading')).toHaveText(account.name, {
        timeout: 30_000,
      })
    })

    await test.step('3. Take the browser offline', async () => {
      await page.context().setOffline(true)
    })

    await test.step('4. Reload the page', async () => {
      await page.reload()
      // Expected: After step 4 [app-shell.status] reaches [state:ready] on [/me],
      //   [user.profile.heading] shows the name the account signed up with, and
      //   [app-shell.sync-message] carries [code:offline]
      await appReady(page)
      await expect(page).toHaveURL(atRoute(CONTRACT_ROUTES['user.profile']))
      await expect(page.getByTestId('user.profile.heading')).toHaveText(account.name)
      await expect(page.getByTestId('app-shell.sync-message')).toHaveAttribute(
        'data-code',
        'offline',
      )
    })

    // Beyond the scenario: the settings open offline from the worker's precache. Online, this
    // browser context loaded the start page, the sign-in and `/me` alone, never `/settings`: the
    // page asked for the settings' script for the first time after going offline, and the worker
    // answered it, so no cache but the worker's precache can have held it for the page.
    await test.step('Open the settings offline: their script, never requested before, comes from the worker', async () => {
      expect(
        requested,
        'the page asked for no settings script before the settings opened',
      ).not.toContain(settingsChunk)

      const answered = page.waitForResponse(
        (response) => new URL(response.url()).pathname === settingsChunk,
        { timeout: 15_000 },
      )

      await page.getByTestId('app-shell.nav.settings-link').click()
      // Expected: the settings, the second-factor section and the passkeys list with its add
      //   control render
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
      await expect(page.getByTestId('user.settings.two-factor.section')).toBeVisible()
      // An empty list has no box to show, and offline the list is empty and in `error`.
      await expect(page.getByTestId('user.settings.passkeys.list')).toBeAttached()
      await expect(page.getByTestId('user.settings.passkeys.add-button')).toBeVisible()
      expect(
        (await answered).fromServiceWorker(),
        'the service worker answered the settings script',
      ).toBe(true)
    })

    await page.context().setOffline(false)
  })
})
