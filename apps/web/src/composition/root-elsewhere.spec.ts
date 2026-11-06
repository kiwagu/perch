import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { type IdentityId, identityIdFactory } from '@workspace/ids'

import { SYNC_STATUS } from '../platform/sync-status.port'

import { bootRoot } from './__fixtures__/root'
import { devicesApi } from './devices-api'
import type { BearerDeps } from './gateway-bearer'
import { organisationsApi } from './organisations-api'
import type { AppRootOptions, AppServices } from './root'
import {
  memoryStorage,
  saveDevice,
  savedIdentity,
  savedToken,
  TOKEN_KEY,
  tokenRecord,
} from './storage'

let services: AppServices | undefined
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await services?.close()
  services = undefined

  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const bob = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  token: 'token-bob',
  memberships: [],
}

const openFailed = () => errAsync(dataError('data:OPEN_FAILED', 'could not open the store'))

const unreached = () => Promise.reject(new Error('the gateway is not reached in these tests'))

/** The organisation and device routes, with the tokens their bearer presents now. */
function routes(): { overrides: Partial<AppRootOptions>; tokens: () => Array<string | undefined> } {
  const bearers: BearerDeps[] = []

  return {
    overrides: {
      // The first organisation route is the shared one; the sign-in's own read names its token.
      organisationsApi: (deps) => {
        if (bearers.length === 0) {
          bearers.push(deps)
        }

        return organisationsApi('/backend', { ...deps, fetcher: unreached })
      },
      devicesApi: (deps) => {
        bearers.push(deps)

        return devicesApi('/backend', { ...deps, fetcher: unreached })
      },
    },
    tokens: () => bearers.map((bearer) => bearer.token()),
  }
}

describe('createAppRoot while another tab of the browser changes who is signed in', () => {
  it('presents the saved token on the organisation and device routes only while it is the session of the account whose space is open', async () => {
    const storage = memoryStorage()
    const { overrides, tokens } = routes()

    saveDevice(storage, ann)

    const { result } = await bootRoot(cleanups, storage, [], [], overrides)

    services = result._unsafeUnwrap()

    expect(tokens()).toEqual([ann.token, ann.token])

    // Another tab signed Ann out and Bob in; this tab, still Ann's, has not followed yet.
    saveDevice(storage, bob)

    expect(services.session.current()?.id).toBe(ann.identity.id)
    expect(tokens()).toEqual([undefined, undefined])
  })

  it("presents no other account's token even read between another tab's writes, the identity saved still the tab's own", async () => {
    const storage = memoryStorage()
    const { overrides, tokens } = routes()

    saveDevice(storage, ann)

    const { result } = await bootRoot(cleanups, storage, [], [], overrides)

    services = result._unsafeUnwrap()

    // Another tab's sign-in of Bob wrote his token; it has not written his identity yet.
    storage.set(TOKEN_KEY, tokenRecord(bob.identity.id, bob.token))

    expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
    expect(tokens()).toEqual([undefined, undefined])
  })

  it('presents no token while the space opens once another tab saved another account, and offers no sign-out of that account when it does not open', async () => {
    const storage = memoryStorage()
    const deleted: IdentityId[] = []
    const { overrides, tokens } = routes()
    let opening: Array<string | undefined> = []

    saveDevice(storage, ann)

    const { result, root } = await bootRoot(cleanups, storage, [], [], {
      ...overrides,
      // Another tab signs Ann out and Bob in while her space opens; this tab hears nothing yet.
      openLocal: () =>
        ResultAsync.fromSafePromise(Promise.resolve()).andThen(() => {
          saveDevice(storage, bob)
          opening = tokens()

          return openFailed()
        }),
      deleteLocal: (identity) => {
        deleted.push(identity)

        return okAsync(undefined)
      },
    })

    services = root

    const failure = result._unsafeUnwrapErr()

    expect(opening).toEqual([undefined, undefined])
    expect(failure).toMatchObject({ kind: 'open-failed', error: { code: 'data:OPEN_FAILED' } })
    expect(failure.kind === 'open-failed' ? failure.signOutHere : 'none').toBeUndefined()
    expect(savedIdentity(storage)?.id).toBe(bob.identity.id)
    expect(savedToken(storage)).toBe(bob.token)
    expect(deleted).toEqual([])
  })

  it('signs out, when asked after the space did not open, that account alone, never one another tab saved since', async () => {
    const storage = memoryStorage()
    const deleted: IdentityId[] = []

    saveDevice(storage, ann)

    const { result, root } = await bootRoot(cleanups, storage, [], [], {
      openLocal: openFailed,
      deleteLocal: (identity) => {
        deleted.push(identity)

        return okAsync(undefined)
      },
    })

    services = root

    const failure = result._unsafeUnwrapErr()
    const signOutHere = failure.kind === 'open-failed' ? failure.signOutHere : undefined

    // Another tab signs Ann out and Bob in; the click comes before this tab hears of it.
    saveDevice(storage, bob)

    expect((await (signOutHere ?? expect.unreachable('offered'))()).isOk()).toBe(true)
    expect(savedIdentity(storage)?.id).toBe(bob.identity.id)
    expect(savedToken(storage)).toBe(bob.token)
    expect(deleted).toEqual([])
  })

  it("goes on hearing the device's sync once the space did not open: the tab may go on as a guest's and sign in again", async () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const { result, root } = await bootRoot(cleanups, storage, [], [], { openLocal: openFailed })

    services = root

    expect(result.isErr()).toBe(true)

    const heard = vi.fn()

    root.container.get(SYNC_STATUS).subscribe(heard)
    // The tab that leads the sync in another tab shares its state.
    storage.changeElsewhere(
      'perch.sync.leader',
      JSON.stringify({ channel: 'up', waiting: false, stopped: false, at: 0 }),
    )

    expect(heard).toHaveBeenCalled()
  })
})
