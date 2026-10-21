import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { type IdentityId, identityIdFactory, noteIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { createNote, organisationShape } from './__fixtures__/note'
import { openTenantSpace, type TenantSpace, TenantSpaces } from './tenant-space'

const ann = identityIdFactory.create()

const membership = (key: string): Membership => ({
  tenant: { id: tenantIdFactory.create(), key, name: key },
  role: 'member',
})

const acme = membership('acme')
const globex = membership('globex')
const initech = membership('initech')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

const openTenantDb = () => openTestDb({ schema: readSchema('tenant'), database: 'tenant' })

/** Organisation databases that open, except those of `failing`; records which were asked for. */
function databases(failing: readonly string[] = []) {
  const asked: Array<{ identity: IdentityId; key: string }> = []
  const open = (identity: IdentityId, key: string): ResultAsync<LocalDb, DataError> => {
    asked.push({ identity, key })

    return failing.includes(key)
      ? errAsync(dataError('data:OPEN_FAILED', `the database of ${key} does not open`))
      : openTenantDb()
  }

  return { asked, open }
}

async function openTenants(
  memberships: readonly Membership[],
  current: string | undefined,
  failing: readonly string[] = [],
) {
  const errors: DataError[] = []
  const opening = databases(failing)
  const tenants = (
    await TenantSpaces.open(
      {
        identity: ann,
        openLocal: opening.open,
        schema: replicaSchema,
        onError: (error) => errors.push(error),
      },
      memberships,
      current,
    )
  )._unsafeUnwrap()

  cleanups.push(async () => {
    await Promise.all(tenants.spaces().map((tenant) => tenant.close()))
  })

  return { tenants, errors, asked: opening.asked }
}

describe('openTenantSpace', () => {
  it("opens the organisation's region in its database and projects what its write path writes", async () => {
    const local = (await openTenantDb())._unsafeUnwrap()
    const close = vi.spyOn(local, 'close')
    const tenant: TenantSpace = (
      await openTenantSpace({
        key: 'acme',
        openLocal: () => okAsync(local),
        schema: replicaSchema,
        onError: (error) => expect.unreachable(error.message),
      })
    )._unsafeUnwrap()
    const id = noteIdFactory.create()

    expect(tenant.key).toBe('acme')
    expect(tenant.region.ref).toEqual({ kind: 'tenant', id: 'tenant:acme' })
    expect((await tenant.unsent())._unsafeUnwrap()).toBe(false)
    expect((await tenant.writePath.run(createNote, { id, author: ann, text: 'Hi' })).isOk()).toBe(
      true,
    )
    expect((await tenant.flush()).isOk()).toBe(true)
    expect((await tenant.runner.read(organisationShape, {}))._unsafeUnwrap()).toMatchObject([
      { id, author: ann, text: 'Hi' },
    ])
    expect((await tenant.unsent())._unsafeUnwrap()).toBe(true)

    await tenant.close()

    expect(close).toHaveBeenCalledOnce()
  })

  it('closes the database when the region cannot load from it', async () => {
    const local = (await openTenantDb())._unsafeUnwrap()
    const close = vi.spyOn(local, 'close')
    const broken = interceptQueries(local, (text) => {
      if (text.includes('FROM _replica_snapshot')) {
        throw new Error('the store is unreadable')
      }
    })

    const opened = await openTenantSpace({
      key: 'acme',
      openLocal: () => okAsync(broken),
      schema: replicaSchema,
      onError: () => {},
    })

    expect(opened._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('TenantSpaces', () => {
  it('makes the chosen organisation current while its database is open, the first by key otherwise', async () => {
    const chosen = await openTenants([globex, acme], 'globex')
    const other = await openTenants([globex, acme], 'initech')

    expect(chosen.tenants.keys()).toEqual(['acme', 'globex'])
    expect(chosen.tenants.current()).toBe('globex')
    expect(chosen.tenants.currentSpace()?.key).toBe('globex')
    expect(chosen.asked.map(({ identity }) => identity)).toEqual([ann, ann])
    expect(other.tenants.current()).toBe('acme')

    other.tenants.select('initech')
    expect(other.tenants.current()).toBe('acme')
    other.tenants.select(undefined)
    expect(other.tenants.currentSpace()).toBeUndefined()
  })

  it('tells its listeners when another organisation becomes current, not while the current one stays', async () => {
    const { tenants } = await openTenants([acme], 'acme')
    let told = 0
    const unlisten = tenants.onChange(() => {
      told += 1
    })

    tenants.select('acme')
    await tenants.change([acme, globex])
    expect(told).toBe(0)

    tenants.select('globex')
    expect(told).toBe(1)

    // The current organisation is left: the first by key becomes current, before the database goes.
    const { left } = await tenants.change([acme])

    expect(told).toBe(2)
    expect(tenants.current()).toBe('acme')
    await tenants.delete(left)

    await tenants.change([])
    expect(told).toBe(3)
    expect(tenants.currentSpace()).toBeUndefined()

    unlisten()
    await tenants.change([acme])
    expect(told).toBe(3)
  })

  it('does not tell a listener that stopped listening while the others were told', async () => {
    const { tenants } = await openTenants([acme, globex], 'acme')
    const told: string[] = []
    let unlistenSecond = (): void => {}

    tenants.onChange(() => {
      told.push('first')
      unlistenSecond()
    })
    unlistenSecond = tenants.onChange(() => {
      told.push('second')
    })

    tenants.select('globex')

    expect(told).toEqual(['first'])
  })

  it('closes the databases it opened when one organisation does not open', async () => {
    const opened: LocalDb[] = []
    const result = await TenantSpaces.open(
      {
        identity: ann,
        openLocal: (_identity, key) =>
          key === 'globex'
            ? errAsync(dataError('data:OPEN_FAILED', 'the database of globex does not open'))
            : openTenantDb().map((local) => {
                opened.push(local)

                return local
              }),
        schema: replicaSchema,
        onError: () => {},
      },
      [acme, globex],
      undefined,
    )

    expect(result._unsafeUnwrapErr().message).toBe('the database of globex does not open')
    expect(opened).toHaveLength(1)
    expect(opened[0]?.db.isConnected).toBe(false)
  })

  it('a change opens new organisations, lets go of those left and reports one that does not open', async () => {
    const { tenants, errors, asked } = await openTenants([acme, globex], 'globex', ['initech'])
    const globexSpace = tenants.currentSpace()

    const same = await tenants.change([globex, acme])

    expect(same).toEqual({ changed: false, left: [] })

    const { changed, left } = await tenants.change([acme, initech])

    expect(changed).toBe(true)
    expect(left.map((tenant) => tenant.key)).toEqual(['globex'])
    expect(left[0]).toBe(globexSpace)
    expect(tenants.keys()).toEqual(['acme'])
    expect(tenants.current()).toBe('acme')
    expect(tenants.memberships()).toEqual([acme, initech])
    expect(errors.map((error) => error.message)).toEqual(['the database of initech does not open'])

    await tenants.delete(left)

    // The organisation that did not open is asked for again by the next change.
    expect((await tenants.change([acme, initech])).changed).toBe(false)
    expect(asked.map(({ key }) => key)).toEqual(['acme', 'globex', 'initech', 'initech'])
  })
})
