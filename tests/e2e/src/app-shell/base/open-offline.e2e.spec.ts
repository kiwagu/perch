// scenario: app-shell/base/open-offline
import { appReady, expect, signUp, test } from '../../support/fixtures'

// The one test that lets the app's service worker run: it opens the app offline.
test.use({ serviceWorkers: 'allow' })

test.describe('Open the app without a network', { tag: '@full' }, () => {
  test('A signed-in device that loaded the app once opens it again offline, with its own data', async ({
    page,
  }) => {
    // The first pull and the account start that step 2 waits for may take up to 30 seconds.
    test.slow()

    // Every script the page loads, with whether the browser was offline then and whether the
    // service worker answered it: the settings' own scripts load only once offline, below.
    const scripts: { url: string; offline: boolean; fromServiceWorker: boolean }[] = []
    let offline = false

    page.on('response', (response) => {
      if (new URL(response.url()).pathname.endsWith('.js')) {
        scripts.push({
          url: response.url(),
          offline,
          fromServiceWorker: response.fromServiceWorker(),
        })
      }
    })

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
      offline = true
    })

    await test.step('4. Reload the page', async () => {
      await page.reload()
      // Expected: After step 4 [app-shell.status] reaches [state:ready] on [/me],
      //   [user.profile.heading] shows the name the account signed up with, and
      //   [app-shell.sync-message] carries [code:offline]
      await appReady(page)
      await expect(page).toHaveURL(/\/me$/)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(account.name)
      await expect(page.getByTestId('app-shell.sync-message')).toHaveAttribute(
        'data-code',
        'offline',
      )
    })

    // Beyond the scenario: the settings open offline from the worker's precache. Online, this
    // browser context loaded the start page, the sign-in and `/me` alone, never `/settings`, so
    // the scripts of the settings page and its two new sections were never fetched by the page
    // and no cache but the worker's precache holds them for it.
    await test.step('Open the settings offline: the scripts they load for the first time come from the worker', async () => {
      const online = new Set(
        scripts.filter((script) => !script.offline).map((script) => script.url),
      )

      await page.getByTestId('app-shell.nav.settings-link').click()
      // Expected: the settings, the second-factor section and the passkeys list render
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
      await expect(page.getByTestId('user.settings.two-factor.section')).toBeVisible()
      // An empty list has no box to show, and offline the list is empty and in `error`.
      await expect(page.getByTestId('user.settings.passkeys.list')).toBeAttached()

      const loadedNow = scripts.filter((script) => script.offline && !online.has(script.url))

      expect(
        loadedNow.length,
        'the settings loaded scripts the page never fetched online',
      ).toBeGreaterThan(0)
      expect(
        loadedNow.filter((script) => !script.fromServiceWorker),
        'the service worker answered every script the settings loaded',
      ).toEqual([])
    })

    await page.context().setOffline(false)
  })
})
