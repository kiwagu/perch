import { ok } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type AuthUser,
  createAuth,
  type DataError,
  type LocalDb,
  openLocalDb,
  recordId,
  tenantDatabase,
} from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import directoryRows from './__fixtures__/directory-rows.surql'
import memberClear from './__fixtures__/member-clear.surql'
import memberForget from './__fixtures__/member-forget.surql'
import memberRows from './__fixtures__/member-rows.surql'
import membershipRows from './__fixtures__/membership-rows.surql'
import namespaceInfo from './__fixtures__/namespace-info.surql'
import tenantInterrupt from './__fixtures__/tenant-interrupt.surql'
import tenantRows from './__fixtures__/tenant-rows.surql'
import tenantSweep from './__fixtures__/tenant-sweep.surql'
import { type OrganisationRefusalCode, Organisations } from './organisations'
import identityByEmailStatement from './surql/identity-by-email.surql'
import memberRemoveStatement from './surql/member-remove.surql'
import membershipAddStatement from './surql/membership-add.surql'
import membershipRemoveStatement from './surql/membership-remove.surql'
import membershipsOfStatement from './surql/memberships-of.surql'
import { TenantDatabases } from './tenant-databases'

const PASSWORD = 'pass-word-1'

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

function refused(code: OrganisationRefusalCode) {
  return { kind: 'refused', code }
}

/** Signs an identity up through the directory's access method, as the gateway does. */
async function signUp(directory: LocalDb, email: string): Promise<AuthUser> {
  const auth = createAuth(directory, {
    access: 'identity',
    namespace: NAMESPACE,
    database: DIRECTORY,
  })

  try {
    return (await auth.signUp({ email, password: PASSWORD }))._unsafeUnwrap()
  } finally {
    await auth.close()
  }
}

/** A statement the organisations' databases hold until it is let go. */
interface Held {
  readonly text: string
  readonly gate: Promise<void>
  readonly reached: () => void
}

/**
 * Organisations over an embedded directory, with each organisation's database on an embedded
 * engine of its own, and three identities: ann, bob and cat. A test can make one statement fail
 * on the organisations' databases, as a broken database would, or hold one there; it can watch
 * and fail the directory's statements. The connections of the identities are a record of the
 * regions taken from them; `steps` lists those revocations and the member-row deletes in order.
 */
async function harness() {
  const directory = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()
  const opened: string[] = []
  /** The statement the organisations' databases refuse, if any. */
  let refusedStatement: string | undefined
  /** The statement the organisations' databases hold, if any. */
  let held: Held | undefined
  /** Hears each statement sent to the directory; it may throw to make the statement fail. */
  let directoryQueries: ((text: string) => void) | undefined
  const steps: string[] = []
  const databases = new TenantDatabases({
    open: (key) => {
      opened.push(key)

      return openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: NAMESPACE,
        database: tenantDatabase(key),
        schema: readSchema('tenant'),
      }).map((local) =>
        interceptQueries(local, (text) => {
          if (text === memberRemoveStatement) {
            steps.push('member-remove')
          }

          if (text === refusedStatement) {
            throw new Error('the database refused the statement')
          }

          if (text === held?.text) {
            held.reached()

            return held.gate
          }
        }),
      )
    },
    clock: manualClock(),
    onError: (error) => failures.push(error),
  })

  cleanups.push(
    () => directory.close(),
    () => databases.close(),
  )

  const organisations = new Organisations({
    directory: interceptQueries(directory, (text) => directoryQueries?.(text)),
    databases,
    revoke: async (identity, region) => {
      steps.push(`revoke ${identity} ${region}`)
    },
  })
  const heard: Array<readonly [IdentityId, readonly Membership[]]> = []

  organisations.onChange(async (identity, memberships) => {
    heard.push([identity, memberships])
  })

  const ann = await signUp(directory, 'ann@example.test')
  const bob = await signUp(directory, 'bob@example.test')
  const cat = await signUp(directory, 'cat@example.test')

  /** The members the organisation's own database holds. */
  const membersIn = async (key: string) => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      const [members] =
        await handle.local.db.query<[Array<{ identity: string; role: string }>]>(memberRows)

      return members
    } finally {
      handle.release()
    }
  }

  /** Empties the organisation's member table. */
  const clearMembers = async (key: string) => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      await handle.local.db.query(memberClear)
    } finally {
      handle.release()
    }
  }

  /** Drops the member row of `identity` from the organisation's database. */
  const forgetMember = async (key: string, identity: IdentityId) => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      await handle.local.db.query(memberForget, { identity })
    } finally {
      handle.release()
    }
  }

  /** Ann creates the organisation, for a test to start from. */
  const founded = async (key = 'acme', name = 'Acme') =>
    (await organisations.create({ identity: ann.id, key, name }))._unsafeUnwrap()

  /** Ann invites the identity that signs in with `email` into acme, for a test to start from. */
  const invited = async (email: string) =>
    (await organisations.invite({ actor: ann.id, key: 'acme', email }))._unsafeUnwrap()

  /** The organisations' databases refuse `statement` from now on; `undefined` lets every one through. */
  const refuseInTenants = (statement: string | undefined) => {
    refusedStatement = statement
  }

  /**
   * The organisations' databases hold `statement` until `release` is called; `waiting` resolves
   * once one is held.
   */
  const holdInTenants = (statement: string) => {
    let release = () => {}
    let reached = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const waiting = new Promise<void>((resolve) => {
      reached = resolve
    })

    held = { text: statement, gate, reached }

    return {
      waiting,
      release: () => {
        held = undefined
        release()
      },
    }
  }

  /** Hears each statement sent to the directory from now on; `undefined` stops listening. */
  const onDirectoryQuery = (listener: ((text: string) => void) | undefined) => {
    directoryQueries = listener
  }

  return {
    organisations,
    opened,
    directory,
    heard,
    steps,
    ann,
    bob,
    cat,
    membersIn,
    clearMembers,
    forgetMember,
    founded,
    invited,
    refuseInTenants,
    holdInTenants,
    onDirectoryQuery,
  }
}

describe('Organisations', () => {
  it('creates an organisation: the directory rows, the database with its schema, the creator as admin member, status ready', async () => {
    const { organisations, ann, directory, heard, membersIn } = await harness()
    const created = (
      await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()

    expect(created.tenant.id).toMatch(/^tnt_/)
    expect(created).toEqual({
      tenant: { id: created.tenant.id, key: 'acme', name: 'Acme' },
      role: 'admin',
    })
    expect(await organisations.membershipsOf(ann.id)).toEqual(ok([created]))
    const [rows] = await directory.db.query<[Array<{ status: string; database: string }>]>(
      tenantRows,
      { key: 'acme' },
    )

    expect(rows).toEqual([{ status: 'ready', database: 't_acme' }])
    const [namespace] =
      await directory.db.query<[{ databases: { t_acme?: string } }]>(namespaceInfo)

    expect(namespace.databases.t_acme).toMatch(/^DEFINE DATABASE t_acme STRICT\b/)
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    expect(heard).toEqual([[ann.id, [created]]])
  })

  it('creates an organisation again under the key of one removed with its database, on a connection opened anew', async () => {
    const { organisations, ann, directory, opened, membersIn } = await harness()
    const first = (
      await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()

    await directory.db.query(tenantSweep, { key: 'acme', database: 't_acme' })
    expect(opened).toEqual(['acme'])

    const again = (
      await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()

    expect(again.tenant.id).not.toBe(first.tenant.id)
    expect(opened).toEqual(['acme', 'acme'])
    expect(await organisations.membershipsOf(ann.id)).toEqual(ok([again]))
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
  })

  it('refuses a key another identity took', async () => {
    const { organisations, bob, founded } = await harness()

    await founded()
    expect(
      (
        await organisations.create({ identity: bob.id, key: 'acme', name: 'Acme too' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('key-taken'))
    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([]))
  })

  it('completes a creation interrupted after the directory row for the same creator', async () => {
    const { organisations, ann, bob, directory, heard, membersIn, clearMembers, founded } =
      await harness()
    const created = await founded()

    await directory.db.query(tenantInterrupt, { key: 'acme' })
    await clearMembers('acme')
    heard.splice(0)

    // An organisation still provisioning is nobody's yet, and its key stays its creator's.
    expect(await organisations.membershipsOf(ann.id)).toEqual(ok([]))
    expect(
      (
        await organisations.create({ identity: bob.id, key: 'acme', name: 'Acme' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('key-taken'))
    expect(await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' })).toEqual(
      ok(created),
    )
    const [rows] = await directory.db.query<[Array<{ status: string; database: string }>]>(
      tenantRows,
      { key: 'acme' },
    )

    expect(rows).toEqual([{ status: 'ready', database: 't_acme' }])
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    expect(heard).toEqual([[ann.id, [created]]])
  })

  it('refuses a key outside the pattern and a name outside 1..80 characters', async () => {
    const { organisations, ann, directory, heard } = await harness()
    const create = async (key: string, name: string) =>
      (await organisations.create({ identity: ann.id, key, name }))._unsafeUnwrapErr()

    expect(await create('Acme', 'Acme')).toEqual(refused('invalid-key'))
    expect(await create('a', 'Acme')).toEqual(refused('invalid-key'))
    expect(await create('acme-corp', 'Acme')).toEqual(refused('invalid-key'))
    expect(await create('acme', '')).toEqual(refused('invalid-name'))
    expect(await create('acme', '   ')).toEqual(refused('invalid-name'))
    expect(await create('acme', 'x'.repeat(81))).toEqual(refused('invalid-name'))
    const [tenants, memberships] = await directory.db.query<[unknown[], unknown[]]>(directoryRows)

    expect(tenants).toEqual([])
    expect(memberships).toEqual([])
    expect(heard).toEqual([])
  })

  it("invites an existing identity as member and tells the invited identity's listeners, not the inviter's", async () => {
    const { organisations, ann, bob, heard, membersIn, founded } = await harness()
    const acme = await founded()

    heard.splice(0)

    expect(
      await organisations.invite({ actor: ann.id, key: 'acme', email: 'bob@example.test' }),
    ).toEqual(ok({ identity: { id: bob.id, email: 'bob@example.test' }, role: 'member' }))
    const joined: Membership = { tenant: acme.tenant, role: 'member' }

    expect(heard).toEqual([[bob.id, [joined]]])
    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([joined]))
    expect(await membersIn('acme')).toEqual([
      { identity: ann.id, role: 'admin' },
      { identity: bob.id, role: 'member' },
    ])
  })

  it('refuses an invite from a member who is not admin', async () => {
    const { organisations, bob, founded, invited } = await harness()

    await founded()
    await invited('bob@example.test')

    expect(
      (
        await organisations.invite({ actor: bob.id, key: 'acme', email: 'cat@example.test' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('not-admin'))
  })

  it('refuses an invite from an outsider', async () => {
    const { organisations, cat, founded } = await harness()

    await founded()

    expect(
      (
        await organisations.invite({ actor: cat.id, key: 'acme', email: 'cat@example.test' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('not-a-member'))
  })

  it('refuses an invite of an unknown email', async () => {
    const { organisations, ann, founded } = await harness()

    await founded()

    expect(
      (
        await organisations.invite({ actor: ann.id, key: 'acme', email: 'dan@example.test' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('no-such-identity'))
  })

  it('refuses an invite of an identity already in', async () => {
    const { organisations, ann, heard, founded, invited } = await harness()

    await founded()
    await invited('bob@example.test')
    heard.splice(0)

    expect(
      (
        await organisations.invite({ actor: ann.id, key: 'acme', email: 'bob@example.test' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('already-member'))
    expect(heard).toEqual([])
  })

  it('restores the member rows of identities already in when they are invited again, with the roles the directory holds', async () => {
    const { organisations, ann, bob, heard, membersIn, forgetMember, founded, invited } =
      await harness()

    await founded()
    await invited('bob@example.test')
    // An invite that failed after the directory membership leaves no member row behind.
    await forgetMember('acme', bob.id)
    await forgetMember('acme', ann.id)
    heard.splice(0)

    for (const email of ['bob@example.test', 'ann@example.test']) {
      expect(
        (await organisations.invite({ actor: ann.id, key: 'acme', email }))._unsafeUnwrapErr(),
      ).toEqual(refused('already-member'))
    }

    expect(await membersIn('acme')).toEqual([
      { identity: ann.id, role: 'admin' },
      { identity: bob.id, role: 'member' },
    ])
    expect(heard).toEqual([])
  })

  it('refuses an invite to an unknown key', async () => {
    const { organisations, ann } = await harness()

    expect(
      (
        await organisations.invite({ actor: ann.id, key: 'acme', email: 'bob@example.test' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('no-such-tenant'))
  })

  it("removes a member: the membership and the member row go, the removed identity's listener hears an empty list", async () => {
    const { organisations, ann, bob, directory, heard, membersIn, founded, invited } =
      await harness()

    await founded()
    await invited('bob@example.test')
    heard.splice(0)

    expect(await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })).toEqual(
      ok(undefined),
    )
    const [memberships] = await directory.db.query<[unknown[]]>(membershipRows, {
      identity: recordId('identity', bob.id),
      key: 'acme',
    })

    expect(memberships).toEqual([])
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    expect(heard).toEqual([[bob.id, []]])
  })

  it('a removal whose member-row delete fails still revokes the region and tells the removed device', async () => {
    const { organisations, ann, bob, heard, steps, membersIn, founded, invited, refuseInTenants } =
      await harness()

    await founded()
    await invited('bob@example.test')
    heard.splice(0)
    refuseInTenants(memberRemoveStatement)

    const failed = await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })

    expect(failed._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    // The directory's membership is gone: bob's devices lose the region and hear it now, not at
    // their next reconnect.
    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([]))
    expect(steps).toEqual([`revoke ${bob.id} tenant:acme`, 'member-remove'])
    expect(heard).toEqual([[bob.id, []]])

    // Asked again, the removal deletes the member row and tells bob's devices once more.
    refuseInTenants(undefined)
    heard.splice(0)

    expect(await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })).toEqual(
      ok(undefined),
    )
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    expect(heard).toEqual([[bob.id, []]])
  })

  it('a removal whose memberships reread fails still revokes the region on the live connection', async () => {
    const { organisations, ann, bob, heard, steps, membersIn, founded, invited, onDirectoryQuery } =
      await harness()

    await founded()
    await invited('bob@example.test')
    heard.splice(0)

    let removed = false

    // The directory goes away for a moment once the membership is deleted.
    onDirectoryQuery((text) => {
      if (text === membershipRemoveStatement) {
        removed = true
      } else if (removed && text === membershipsOfStatement) {
        throw new Error('the directory went away for a moment')
      }
    })

    const failed = await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })

    expect(failed._unsafeUnwrapErr()).toEqual(
      expect.objectContaining({
        code: 'data:QUERY_FAILED',
        message: `could not read the memberships of ${bob.id}`,
      }),
    )
    // Bob's connections lost the region before the member row went, though nobody could be
    // told the memberships.
    expect(steps).toEqual([`revoke ${bob.id} tenant:acme`, 'member-remove'])
    expect(heard).toEqual([])

    onDirectoryQuery(undefined)

    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([]))
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
  })

  it('a removal paused before its tenant step and a concurrent invite of the same identity end in a consistent state', async () => {
    const {
      organisations,
      ann,
      bob,
      heard,
      steps,
      membersIn,
      founded,
      invited,
      holdInTenants,
      onDirectoryQuery,
    } = await harness()
    const acme = await founded()

    await invited('bob@example.test')
    heard.splice(0)

    const held = holdInTenants(memberRemoveStatement)
    const removal = organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })

    await held.waiting

    const directorySteps: string[] = []

    onDirectoryQuery((text) => directorySteps.push(text))

    const invite = organisations.invite({ actor: ann.id, key: 'acme', email: 'bob@example.test' })

    // The invite finds bob, then waits for the removal: it writes no membership meanwhile.
    await vi.waitFor(() => expect(directorySteps).toContain(identityByEmailStatement))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(directorySteps).not.toContain(membershipAddStatement)

    held.release()

    expect(await removal).toEqual(ok(undefined))
    expect(await invite).toEqual(
      ok({ identity: { id: bob.id, email: 'bob@example.test' }, role: 'member' }),
    )

    const joined: Membership = { tenant: acme.tenant, role: 'member' }

    // Removed, then invited again: the directory and the organisation's database agree.
    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([joined]))
    expect(await membersIn('acme')).toEqual([
      { identity: ann.id, role: 'admin' },
      { identity: bob.id, role: 'member' },
    ])
    expect(heard).toEqual([
      [bob.id, []],
      [bob.id, [joined]],
    ])
    expect(steps).toEqual([`revoke ${bob.id} tenant:acme`, 'member-remove'])
  })

  it('removes an identity that is not a member: nothing changes, and its listener hears the memberships it has', async () => {
    const { organisations, ann, cat, heard, membersIn, founded } = await harness()

    await founded()
    heard.splice(0)

    expect(await organisations.remove({ actor: ann.id, key: 'acme', identity: cat.id })).toEqual(
      ok(undefined),
    )
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    expect(await organisations.membershipsOf(cat.id)).toEqual(ok([]))
    // A removal cannot tell a first one from one asked again after a failure: it always tells.
    expect(heard).toEqual([[cat.id, []]])
  })

  it('refuses removing yourself', async () => {
    const { organisations, ann, founded } = await harness()

    await founded()

    expect(
      (
        await organisations.remove({ actor: ann.id, key: 'acme', identity: ann.id })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('self'))
  })

  it('a member cannot remove', async () => {
    const { organisations, ann, bob, membersIn, founded, invited } = await harness()

    await founded()
    await invited('bob@example.test')

    expect(
      (
        await organisations.remove({ actor: bob.id, key: 'acme', identity: ann.id })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('not-admin'))
    expect(await membersIn('acme')).toHaveLength(2)
  })

  it('lists the members with their emails for an admin, not for a member nor an outsider', async () => {
    const { organisations, ann, bob, cat, founded, invited } = await harness()

    await founded()
    await invited('bob@example.test')
    const members = [
      { identity: { id: ann.id, email: 'ann@example.test' }, role: 'admin' },
      { identity: { id: bob.id, email: 'bob@example.test' }, role: 'member' },
    ]

    expect(await organisations.membersOf({ actor: ann.id, key: 'acme' })).toEqual(ok(members))
    expect(
      (await organisations.membersOf({ actor: bob.id, key: 'acme' }))._unsafeUnwrapErr(),
    ).toEqual(refused('not-admin'))
    expect(
      (await organisations.membersOf({ actor: cat.id, key: 'acme' }))._unsafeUnwrapErr(),
    ).toEqual(refused('not-a-member'))
  })

  it('lists memberships ordered by key, only of ready tenants', async () => {
    const { organisations, ann, directory, founded } = await harness()
    const globex = await founded('globex', 'Globex')
    const acme = await founded()

    await founded('initech', 'Initech')
    await directory.db.query(tenantInterrupt, { key: 'initech' })

    expect(await organisations.membershipsOf(ann.id)).toEqual(ok([acme, globex]))
  })
})
