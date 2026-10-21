import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import { regionDatabases } from './region-databases'

const opened: LocalDb[] = []

afterEach(async () => {
  for (const local of opened.splice(0)) {
    await local.close()
  }
})

async function openDb(): Promise<LocalDb> {
  const local = (await openTestDb())._unsafeUnwrap()

  opened.push(local)

  return local
}

/** Organisation databases that hand out `local` and count what was acquired and released. */
function countingTenants(local: LocalDb) {
  const acquired: string[] = []
  let released = 0

  return {
    acquired,
    released: () => released,
    tenants: {
      acquire: (key: string) => {
        acquired.push(key)

        return okAsync({
          local,
          release: () => {
            released += 1
          },
        })
      },
    },
  }
}

describe('regionDatabases', () => {
  it("names the directory for every private region and its own database for an organisation's region", async () => {
    const { tenants } = countingTenants(await openDb())
    const databases = regionDatabases(await openDb(), tenants)

    expect(databases.databaseOf({ kind: 'private', id: 'identity:idn_a' })).toBe('directory')
    expect(databases.databaseOf({ kind: 'private', id: 'identity:idn_b' })).toBe('directory')
    expect(databases.databaseOf({ kind: 'tenant', id: 'tenant:acme' })).toBe('t_acme')
  })

  it('serves a private region from the directory, with nothing to release', async () => {
    const directory = await openDb()
    const { tenants, acquired } = countingTenants(await openDb())
    const database = (
      await regionDatabases(directory, tenants).acquire({ kind: 'private', id: 'identity:idn_a' })
    )._unsafeUnwrap()

    expect(database.local).toBe(directory)
    database.release()
    expect(acquired).toEqual([])
  })

  it("serves a tenant region from its organisation's database and lets it go on release", async () => {
    const acme = await openDb()
    const { tenants, acquired, released } = countingTenants(acme)
    const database = (
      await regionDatabases(await openDb(), tenants).acquire({ kind: 'tenant', id: 'tenant:acme' })
    )._unsafeUnwrap()

    expect(database.local).toBe(acme)
    expect(acquired).toEqual(['acme'])

    database.release()

    expect(released()).toBe(1)
  })

  it('refuses a region no database of the gateway holds', async () => {
    const { tenants, acquired } = countingTenants(await openDb())
    const databases = regionDatabases(await openDb(), tenants)

    for (const region of [
      { kind: 'public', id: 'public:catalog' },
      { kind: 'tenant', id: 'tenant:Not-A-Key' },
    ] as const) {
      expect((await databases.acquire(region))._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    }

    expect(acquired).toEqual([])
  })
})
