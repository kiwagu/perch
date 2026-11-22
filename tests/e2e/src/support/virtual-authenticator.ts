/**
 * The authenticator of the browser a passkey test runs in: a virtual one, so the browser makes
 * passkeys and unlocks them at once, with no dialog of the operating system.
 */

import type { Page } from '@playwright/test'

/**
 * Gives `page` a virtual authenticator through the Chrome DevTools protocol: a platform one
 * (`internal`) that keeps discoverable credentials, verifies the user and answers every test of
 * presence at once. It keeps its passkeys until the page's browser context closes, whatever an
 * account does with them, so a test adds it once, for the page that makes and uses the passkeys.
 */
export async function addVirtualAuthenticator(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page)

  await session.send('WebAuthn.enable')
  await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}
