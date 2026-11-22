// @vitest-environment jsdom
/**
 * The settings page brings its code only to a signed-in device that opens it: a guest at its
 * address is sent to sign in and none of its code is loaded for it, and the code loads once, at
 * the route's first opening, whoever opens it next.
 */

import { describe, expect, it, vi } from 'vitest'

import { GUEST, IDENTITY } from '@workspace/ui-contract/anchors'

import { routerOf } from '../../platform/__fixtures__/router'
import { NotFoundModule } from '../not-found/not-found.module'

import { UserModule } from './user.module'

/** How often the settings page's code has been loaded. */
const loaded = vi.hoisted(() => ({ settings: 0 }))

vi.mock('./presentation/pages/settings/settings.container', (original) => {
  loaded.settings += 1

  return original()
})

/** The router of the user pages at `path` for a device holding `roles`, loaded; nothing renders it. */
async function opened(roles: readonly string[], path: string) {
  const router = routerOf([UserModule, NotFoundModule], roles, path)

  await router.load()

  return router
}

describe('the settings page', () => {
  it('loads its code at the first opening by a signed-in device, never for a guest, and once', async () => {
    const guest = await opened([GUEST], '/settings')

    expect(guest.state.location.pathname).toBe('/sign-in')
    expect(loaded.settings).toBe(0)

    const signedIn = await opened([IDENTITY], '/settings')

    expect(signedIn.state.location.pathname).toBe('/settings')
    expect(signedIn.state.matches.at(-1)?.status).toBe('success')
    expect(loaded.settings).toBe(1)

    // The browser loads the module once, however many routers open the page.
    await opened([IDENTITY, 'admin'], '/settings')

    expect(loaded.settings).toBe(1)
  })
})
