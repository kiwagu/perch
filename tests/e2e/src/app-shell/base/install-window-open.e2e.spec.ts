// scenario: app-shell/base/install-window-open
import type { Page } from '@playwright/test'

import { appReady, expect, signUp, syncSays, test } from '../../support/fixtures'
import { BACK_ONLINE_MS, SyncNetwork } from '../../support/network'

/** What the browser's window to install the app answers once the person has chosen in it. */
interface InstallChoice {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

declare global {
  interface Window {
    /** Answers the install window the test's offer opened; the offer sets it when it is made. */
    answerInstallWindow?: (choice: InstallChoice) => void
  }
}

const reminder = (page: Page) => page.getByTestId('app-shell.install-message')

/**
 * The browser offers to install the app, its window staying open until `answerInstallWindow`
 * answers it: Chromium's own `beforeinstallprompt` comes only when the browser judges the site
 * installable, which a headless browser never does, so the test makes the offer the page would
 * hear, its `userChoice` a promise the test settles later.
 */
async function browserOffersAndWaits(page: Page) {
  await page.evaluate(() => {
    const choice = new Promise<InstallChoice>((resolve) => {
      window.answerInstallWindow = resolve
    })
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => Promise.resolve(),
      userChoice: choice,
    })

    window.dispatchEvent(offer)
  })
}

/** The person answers the browser's window with `choice`, which closes it. */
async function answerInstallWindow(page: Page, choice: InstallChoice) {
  await page.evaluate((answer) => {
    const open = window.answerInstallWindow

    if (!open) {
      throw new Error("the browser's window to install the app was never offered")
    }

    open(answer)
  }, choice)
}

test.describe("Follow the sync while the browser's install window is open", {
  tag: '@full',
}, () => {
  test("The state of the sync shows while the browser's window to install the app is open, and the reminder goes once the app is installed", async ({
    page,
  }) => {
    // The page's sync socket is routed before it opens the app, so the test can take its network
    // away.
    const network = await SyncNetwork.attach(page)

    await test.step('1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
      await signUp(page)
      await appReady(page)
      // Expected: After step 1 [app-shell.sync-message] carries [code:synced]
      await syncSays(page, 'synced')
    })

    await test.step('2. The browser offers to install the app', async () => {
      await browserOffersAndWaits(page)
      // Expected: After step 2 [app-shell.install-message] carries [code:install-available]
      await expect(reminder(page)).toHaveAttribute('data-code', 'install-available')
    })

    await test.step("3. Click [app-shell.install-button]; the browser's window to install the app opens and stays open", async () => {
      await page.getByTestId('app-shell.install-button').click()
    })

    await test.step('4. Take the browser offline', async () => {
      await network.goOffline()
      // Expected: After step 4 [app-shell.sync-message] carries [code:offline] while the browser's
      //   window is open
      await syncSays(page, 'offline')
    })

    await test.step("5. Accept the browser's window", async () => {
      await answerInstallWindow(page, { outcome: 'accepted', platform: 'web' })
      // Expected: After step 5 no [app-shell.install-message] shows, and [app-shell.sync-message]
      //   still carries [code:offline]
      await expect(reminder(page)).toHaveCount(0)
      await syncSays(page, 'offline')
    })

    await test.step('6. Bring the browser back online', async () => {
      await network.goOnline()
      // Expected: After step 6 [app-shell.sync-message] carries [code:synced]
      await syncSays(page, 'synced', BACK_ONLINE_MS)
    })
  })
})
