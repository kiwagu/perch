import { ok } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type DataError,
  type LocalDb,
  openLocalDb,
  recordId,
  tenantDatabase,
} from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import {
  type IdentityId,
  identityIdFactory,
  membershipIdFactory,
  noteIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import identityRow from '../auth/__fixtures__/identity-row.surql'
import { DIRECTORY, NAMESPACE } from '../config'

import directoryRows from './__fixtures__/directory-rows.surql'
import memberRows from './__fixtures__/member-rows.surql'
import membershipPromote from './__fixtures__/membership-promote.surql'
import membershipRows from './__fixtures__/membership-rows.surql'
import namespaceInfo from './__fixtures__/namespace-info.surql'
import noteRows from './__fixtures__/note-rows.surql'
import noteWrite from './__fixtures__/note-write.surql'
import tenantInterrupt from './__fixtures__/tenant-interrupt.surql'
import tenantRows from './__fixtures__/tenant-rows.surql'
import { AccountDeparture } from './account-departure'
import { Organisations } from './organisations'
import memberRemoveStatement from './surql/member-remove.surql'
import membershipAddStatement from './surql/membership-add.surql'
import membershipRemoveStatement from './surql/membership-remove.surql'
import tenantRemoveStatement from './surql/tenant-remove.surql'
import { TenantDatabases } from './tenant-databases'

/** Closes what a test opened, the organisations' databases before the directory. */
const cleanups: Array<() => Promise<void>> = []

/** Failures of the tenant databases that no test expected. */
const failures: DataError[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }

  expect(failures.splice(0)).toEqual([])
})

/**
 * A departure over an embedded directory, with each organisation's database on an embedded
 * engine of its own (a connection opened anew after an eviction starts empty), the organisations
 * that set the scene up, and three identities: ann, bob and cat. A test can make one statement
 * fail on the departure's directory or on the organisations' databases, as a broken database
 * would.
 */
async function harness() {
  const directory = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()
  const opened: string[] = []
  /** The statement the departure's directory and the organisations' databases refuse, if any. */
  let refusedStatement: string | undefined
  const refusing = (text: string) => {
    if (text === refusedStatement) {
      throw new Error('the database refused the statement')
    }
  }
  const databases = new TenantDatabases({
    open: (key) => {
      opened.push(key)

      return openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: NAMESPACE,
        database: tenantDatabase(key),
        schema: readSchema('tenant'),
      }).map((local) => interceptQueries(local, refusing))
    },
    clock: manualClock(),
    onError: (error) => failures.push(error),
  })

  cleanups.push(
    () => directory.close(),
    () => databases.close(),
  )

  const organisations = new Organisations({ directory, databases, revoke: async () => {} })
  const departure = new AccountDeparture({
    directory: interceptQueries(directory, refusing),
    databases,
  })

  /** An identity written straight into the directory. */
  const identity = async (email: string): Promise<IdentityId> => {
    const key = identityIdFactory.create()

    await directory.db.query(identityRow, { key, email })

    return key
  }

  const ann = await identity('ann@example.test')
  const bob = await identity('bob@example.test')
  const cat = await identity('cat@example.test')

  /** `creator` creates the organisation `key`, for a test to start from. */
  const founded = async (creator: IdentityId, key: string) =>
    (await organisations.create({ identity: creator, key, name: key }))._unsafeUnwrap()

  /** `actor` invites the identity that signs in with `email` into `key`. */
  const invited = async (actor: IdentityId, key: string, email: string) =>
    (await organisations.invite({ actor, key, email }))._unsafeUnwrap()

  /** Runs `work` on the organisation's database, holding it meanwhile. */
  const inTenant = async <T>(key: string, work: (local: LocalDb) => Promise<T>): Promise<T> => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      return await work(handle.local)
    } finally {
      handle.release()
    }
  }

  /** The members the organisation's own database holds, admins first. */
  const membersIn = (key: string) =>
    inTenant(key, async (local) => {
      const [rows] = await local.db.query<[Array<{ identity: string; role: string }>]>(memberRows)

      return rows
    })

  /** The notes the organisation's own database holds, with their authors. */
  const notesIn = (key: string) =>
    inTenant(key, async (local) => {
      const [rows] = await local.db.query<[Array<{ author: string; text: string }>]>(noteRows)

      return rows
    })

  /** `author` writes a note in the organisation's database. */
  const noted = (key: string, author: IdentityId, text: string) =>
    inTenant(key, (local) =>
      local.db.query(noteWrite, { id: noteIdFactory.create(), author, text }),
    )

  /** The definition of the organisation's database in the namespace, if it is defined. */
  const definitionOf = async (key: string) => {
    const [namespace] =
      await directory.db.query<[{ databases: Record<string, string | undefined> }]>(namespaceInfo)

    return namespace.databases[tenantDatabase(key)]
  }

  /** The directory's row of the organisation with `key`, if any. */
  const tenantRowOf = async (key: string) => {
    const [rows] = await directory.db.query<[Array<{ status: string }>]>(tenantRows, { key })

    return rows
  }

  /** The roles `identity` holds in the organisation with `key`, by the directory. */
  const rolesIn = async (identity: IdentityId, key: string) => {
    const [rows] = await directory.db.query<[Array<{ role: string }>]>(membershipRows, {
      identity: recordId('identity', identity),
      key,
    })

    return rows.map((row) => row.role)
  }

  /** Every organisation's key and every membership's role the directory holds. */
  const everything = async () => {
    const [tenants, memberships] =
      await directory.db.query<[Array<{ key: string }>, Array<{ role: string }>]>(directoryRows)

    return { tenants: tenants.map((row) => row.key).sort(), memberships: memberships.length }
  }

  /** `statement` is refused from now on; `undefined` refuses none. */
  const refuse = (statement: string | undefined) => {
    refusedStatement = statement
  }

  return {
    organisations,
    departure,
    directory,
    opened,
    ann,
    bob,
    cat,
    founded,
    invited,
    membersIn,
    notesIn,
    noted,
    definitionOf,
    tenantRowOf,
    rolesIn,
    everything,
    refuse,
  }
}

describe('AccountDeparture', () => {
  it('takes an organisation the identity is the only member of whole: its database, its row and its membership, and its key is free again', async () => {
    const {
      organisations,
      departure,
      opened,
      ann,
      bob,
      founded,
      membersIn,
      definitionOf,
      tenantRowOf,
      rolesIn,
    } = await harness()

    await founded(ann, 't1')

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await definitionOf('t1')).toBeUndefined()
    expect(await tenantRowOf('t1')).toEqual([])
    expect(await rolesIn(ann, 't1')).toEqual([])
    expect(await organisations.membershipsOf(ann)).toEqual(ok([]))

    // The cached connection went with the database: the next one is opened anew.
    expect(opened).toEqual(['t1'])
    expect(await membersIn('t1')).toEqual([])
    expect(opened).toEqual(['t1', 't1'])

    const again = await founded(bob, 't1')

    expect(again.tenant.key).toBe('t1')
    expect(await membersIn('t1')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('is blocked while the identity is the only admin of a ready organisation with other members', async () => {
    const { departure, ann, bob, founded, invited } = await harness()

    await founded(ann, 't2')
    await invited(ann, 't2', 'bob@example.test')

    expect(await departure.blocked(ann)).toEqual(ok(true))
    expect(await departure.blocked(bob)).toEqual(ok(false))
  })

  it('takes the identity out of an organisation others belong to: its membership and member row go, the others and its notes stay', async () => {
    const {
      organisations,
      departure,
      ann,
      bob,
      founded,
      invited,
      membersIn,
      notesIn,
      noted,
      definitionOf,
      rolesIn,
    } = await harness()
    const t3 = await founded(bob, 't3')

    await invited(bob, 't3', 'ann@example.test')
    await noted('t3', ann, 'written by ann')

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await rolesIn(ann, 't3')).toEqual([])
    expect(await rolesIn(bob, 't3')).toEqual(['admin'])
    expect(await organisations.membershipsOf(bob)).toEqual(ok([t3]))
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
    expect(await notesIn('t3')).toEqual([{ author: ann, text: 'written by ann' }])
    expect(await definitionOf('t3')).toMatch(/^DEFINE DATABASE t_t3 STRICT\b/)
  })

  it('leaves again as a no-op once every membership is gone', async () => {
    const { departure, ann, bob, founded, invited, membersIn, everything } = await harness()

    await founded(ann, 't1')
    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')

    expect(await departure.leave(ann)).toEqual(ok(undefined))
    const left = await everything()

    expect(left).toEqual({ tenants: ['t3'], memberships: 1 })
    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await everything()).toEqual(left)
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('is not blocked by an organisation that has another admin, which the identity then leaves', async () => {
    const { departure, directory, ann, bob, cat, founded, invited, membersIn, rolesIn } =
      await harness()

    await founded(ann, 't4')
    await invited(ann, 't4', 'cat@example.test')
    await invited(ann, 't4', 'bob@example.test')
    await directory.db.query(membershipPromote, { identity: recordId('identity', cat), key: 't4' })

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await rolesIn(cat, 't4')).toEqual(['admin'])
    expect(await rolesIn(bob, 't4')).toEqual(['member'])
    expect((await membersIn('t4')).map((row) => row.identity).sort()).toEqual([bob, cat].sort())
  })

  it('counts only ready organisations for the block, and takes one still provisioning whole', async () => {
    const { departure, directory, ann, founded, invited, definitionOf, everything } =
      await harness()

    await founded(ann, 't5')
    await invited(ann, 't5', 'bob@example.test')
    await directory.db.query(tenantInterrupt, { key: 't5' })
    await founded(ann, 't6')
    await directory.db.query(tenantInterrupt, { key: 't6' })

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await definitionOf('t6')).toBeUndefined()
    expect(await everything()).toEqual({ tenants: ['t5'], memberships: 1 })
  })

  it('completes a departure whose removal of an organisation failed when it runs again', async () => {
    const { departure, ann, founded, definitionOf, everything, refuse } = await harness()

    await founded(ann, 't1')
    refuse(tenantRemoveStatement)

    expect((await departure.leave(ann))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    expect(await everything()).toEqual({ tenants: ['t1'], memberships: 1 })

    refuse(undefined)

    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await definitionOf('t1')).toBeUndefined()
    expect(await everything()).toEqual({ tenants: [], memberships: 0 })
  })

  it('completes a departure whose removal of a member row failed when it runs again', async () => {
    const { departure, ann, bob, founded, invited, membersIn, rolesIn, refuse } = await harness()

    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')
    refuse(memberRemoveStatement)

    expect((await departure.leave(ann))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    // The membership stays until the member row went: the next run still finds the organisation.
    expect(await rolesIn(ann, 't3')).toEqual(['member'])

    refuse(undefined)

    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await rolesIn(ann, 't3')).toEqual([])
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('completes a departure whose removal of a membership failed after the member row went', async () => {
    const { departure, ann, bob, founded, invited, membersIn, rolesIn, refuse } = await harness()

    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')
    refuse(membershipRemoveStatement)

    expect((await departure.leave(ann))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    expect(await rolesIn(ann, 't3')).toEqual(['member'])
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])

    refuse(undefined)

    expect(await departure.leave(ann)).toEqual(ok(undefined))
    expect(await rolesIn(ann, 't3')).toEqual([])
    expect(await rolesIn(bob, 't3')).toEqual(['admin'])
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('answers an error, never a guess, for a membership whose organisation is gone', async () => {
    const { departure, directory, ann } = await harness()

    await directory.db.query(membershipAddStatement, {
      id: membershipIdFactory.create(),
      identity: recordId('identity', ann),
      tenant: recordId('tenant', tenantIdFactory.create()),
      role: 'admin',
    })

    const unknown = {
      code: 'data:QUERY_FAILED',
      message: `the memberships of ${ann} to leave have an unknown shape`,
    }

    expect((await departure.blocked(ann))._unsafeUnwrapErr()).toMatchObject(unknown)
    expect((await departure.leave(ann))._unsafeUnwrapErr()).toMatchObject(unknown)
  })
})
