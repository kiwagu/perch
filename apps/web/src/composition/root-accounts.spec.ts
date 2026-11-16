import { afterEach, describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { ACCOUNTS } from '../platform/accounts.port'

import { fakeFetch, respond } from './__fixtures__/gateway-fetch'
import { bootRoot } from './__fixtures__/root'
import { signedIn } from './__fixtures__/signed-in'
import { accountsApi } from './accounts-api'
import type { AppServices } from './root'
import { type KeptDevice, memoryStorage, savedRoles, saveRoles } from './storage'

let services: AppServices | undefined
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await services?.close()
  services = undefined

  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

describe('createAppRoot binds ACCOUNTS', () => {
  it("over the console routes, asking with the token saved for the account this tab shows and the device's id", async () => {
    const storage = memoryStorage()
    const gateway = fakeFetch(respond(200, { accounts: [], total: 0 }))

    signedIn(storage, ann)

    const { result } = await bootRoot(cleanups, storage, [], [], {
      accountsApi: (deps) => accountsApi('/backend', { ...deps, fetcher: gateway.fetcher }),
    })

    services = result._unsafeUnwrap()

    const accounts = services.container.get(ACCOUNTS)

    expect((await accounts.list({ q: '', page: 1, size: 25 }))._unsafeUnwrap()).toEqual({
      accounts: [],
      total: 0,
    })
    expect(gateway.sent.map(({ authorization, device }) => [authorization, device])).toEqual([
      ['Bearer token-ann', storage.get('perch.device.id')],
    ])
  })

  it('takes operator off the roles of the account that asked once the gateway refuses it as no operator, and the session tells it', async () => {
    const storage = memoryStorage()
    const gateway = fakeFetch(respond(403, { code: 'not-operator' }))

    const session = signedIn(storage, ann)

    saveRoles(storage, session, ['operator'])

    const { result } = await bootRoot(cleanups, storage, [], [], {
      accountsApi: (deps) => accountsApi('/backend', { ...deps, fetcher: gateway.fetcher }),
    })

    services = result._unsafeUnwrap()

    const heard: string[][] = []

    services.session.onRoles((roles) => heard.push([...roles]))

    expect([...services.session.roles()]).toEqual(['operator'])

    const refused = await services.container.get(ACCOUNTS).list({ q: '', page: 1, size: 25 })

    expect(refused._unsafeUnwrapErr().code).toBe('not-operator')
    expect(savedRoles(storage, session)).toEqual([])
    expect(services.session.roles().size).toBe(0)
    expect(heard).toEqual([[]])
  })
})
