import { ok, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type AuthUser,
  type DataError,
  type LocalDb,
  openLocalDb,
  recordId,
  tenantDatabase,
} from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import { type IdentityId, idSchemas } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'

import {
  AUTH_SECRET,
  AUTH_URL,
  deviceHeaders,
  mailsOf,
  signUpOn,
} from '../../auth/__fixtures__/auth-instance'
import { createAuthInstance } from '../../auth/auth-instance'
import { DIRECTORY, NAMESPACE } from '../../config'
import { Outbox } from '../../mail/__fixtures__/outbox'
import directoryRows from '../__fixtures__/directory-rows.surql'
import identityForget from '../__fixtures__/identity-forget.surql'
import { admitted, specInvitations } from '../__fixtures__/invitations'
import memberClear from '../__fixtures__/member-clear.surql'
import memberForget from '../__fixtures__/member-forget.surql'
import memberRows from '../__fixtures__/member-rows.surql'
import membershipRows from '../__fixtures__/membership-rows.surql'
import namespaceInfo from '../__fixtures__/namespace-info.surql'
import { readFailingAfter, specRetell } from '../__fixtures__/retell'
import tenantInterrupt from '../__fixtures__/tenant-interrupt.surql'
import tenantRows from '../__fixtures__/tenant-rows.surql'
import tenantSweep from '../__fixtures__/tenant-sweep.surql'
import { OrganisationLookup } from '../organisation-lookup'
import type { OrganisationRefusalCode } from '../organisation-refusal'
import { keyOf } from '../organisation-rows'
import invitationAcceptStatement from '../surql/invitation-accept.surql'
import memberAddStatement from '../surql/member-add.surql'
import memberRemoveStatement from '../surql/member-remove.surql'
import membershipRemoveStatement from '../surql/membership-remove.surql'
import membershipSetRoleStatement from '../surql/membership-set-role.surql'
import membershipsOfTenantStatement from '../surql/memberships-of-tenant.surql'
import tenantReadyStatement from '../surql/tenant-ready.surql'
import tenantRemoveStatement from '../surql/tenant-remove.surql'
import { TenantDatabases } from '../tenant-databases'
import { TenantMembers } from '../tenant-members'

import { OrganisationAdmission } from './admission'
import { Organisations } from './service'
import { MembershipTurns } from './turns'

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

/**
 * Signs an identity up through Better Auth over the directory, as the gateway does, and verifies
 * it through the mail the sign-up sent.
 */
async function signUp(directory: LocalDb, email: string): Promise<AuthUser> {
  const outbox = new Outbox()
  const auth = createAuthInstance({
    local: directory,
    secret: AUTH_SECRET,
    baseURL: AUTH_URL,
    trustedOrigins: [new URL(AUTH_URL).origin],
    clock: manualClock(),
    publicUrl: new URL(AUTH_URL).origin,
    mail: outbox,
    log: { error: () => {}, warn: () => {} },
  })

  mailsOf(auth, outbox)

  const { user } = await signUpOn(auth, email, deviceHeaders(`device-${email}`))

  return { id: idSchemas.identity.schema.parse(user.id), email: user.email }
}

/** A statement the organisations' databases hold until it is let go. */
interface Held {
  readonly text: string
  readonly gate: Promise<void>
  readonly reached: () => void
}

/**
 * Organisations over an embedded directory, with each organisation's database on an embedded
 * engine of its own, three identities: ann, bob and cat, and the re-tells on a clock the test
 * moves. A test can make one statement fail
 * on the organisations' databases, as a broken database would, or hold one there; it can watch
 * and fail the directory's statements. The connections of the identities are a record of the
 * regions taken from them and the roles given again; `steps` lists those revocations and
 * re-judgings and the member-row deletes in order.
 */
async function harness() {
  const directory = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()
  const clock = manualClock()
  const opened: string[] = []
  /** The statement the organisations' databases refuse, if any. */
  let refusedStatement: string | undefined
  /** The statement the organisations' databases hold, if any. */
  let held: Held | undefined
  /** The statement the directory holds, if any. */
  let directoryHeld: Held | undefined
  /**
   * Hears each statement sent to the directory; it may throw to make the statement fail, or
   * answer a promise to hold it until that settles.
   */
  let directoryQueries: ((text: string) => void | Promise<void>) | undefined
  /** Whether the connections take a re-judging. */
  let rerolls = true
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
    directory: interceptQueries(directory, (text) => {
      const heard = directoryQueries?.(text)

      if (text === directoryHeld?.text) {
        directoryHeld.reached()

        return directoryHeld.gate
      }

      return heard
    }),
    databases,
    revoke: async (identity, region) => {
      steps.push(`revoke ${identity} ${region}`)
    },
    rerole: async (identity, region, role) => {
      steps.push(`rerole ${identity} ${region} ${role}`)

      if (!rerolls) {
        throw new Error('the registry is down')
      }
    },
    // No device subscribes to a region here: the hub has none to let go of.
    hub: { retire: () => okAsync(undefined) },
    invitations: specInvitations(directory),
    retell: specRetell({ clock }),
  })
  const heard: Array<readonly [IdentityId, readonly Membership[]]> = []

  organisations.onChange(async (identity, memberships) => {
    heard.push([identity, memberships])
  })
  cleanups.push(() => organisations.close())

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

  /** The roles the organisation's own database holds, by the key of the identity. */
  const memberRolesIn = async (key: string) =>
    Object.fromEntries((await membersIn(key)).map((row) => [row.identity, row.role]))

  /** The roles the directory holds for `identity` in the organisation with `key`. */
  const rolesOf = async (key: string, identity: IdentityId) => {
    const [rows] = await directory.db.query<[Array<{ role: string }>]>(membershipRows, {
      identity: recordId('identity', identity),
      key,
    })

    return rows.map((row) => row.role)
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

  /**
   * Ann invites the account that signs in with `email` into acme and it accepts, for a test to
   * start from.
   */
  const invited = async (email: string) => {
    const invitee = [ann, bob, cat].find((account) => account.email === email)

    if (invitee === undefined) {
      throw new Error('no account of the harness has this email')
    }

    return admitted(organisations, { actor: ann.id, key: 'acme', invitee })
  }

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

  /**
   * The directory holds `statement` until `release` is called; `reached` resolves once one is
   * held.
   */
  const holdDirectory = (statement: string) => {
    let release = () => {}
    let arrived = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const reached = new Promise<void>((resolve) => {
      arrived = resolve
    })

    directoryHeld = { text: statement, gate, reached: arrived }

    return {
      reached,
      release: () => {
        directoryHeld = undefined
        release()
      },
    }
  }

  /** Hears each statement sent to the directory from now on; `undefined` stops listening. */
  const onDirectoryQuery = (listener: ((text: string) => void | Promise<void>) | undefined) => {
    directoryQueries = listener
  }

  /** The connections answer a re-judging (the default), or fail it. */
  const letRerole = (allowed: boolean) => {
    rerolls = allowed
  }

  /**
   * Moves the re-tells' clock past the first delay, and waits until the harness's listener heard
   * `times` more changes: the re-tells due, once their turn came and they read the directory.
   */
  const retold = async (times = 1) => {
    const before = heard.length

    await clock.advance(1_200)
    await vi.waitFor(
      () => {
        expect(heard.length).toBe(before + times)
      },
      { timeout: 5_000, interval: 1 },
    )
    await flush()
  }

  /**
   * Watches the queues of the organisations' turns (`ofTenants`, the default) or of the
   * identities' (`ofIdentity`). `untilQueued()` answers a promise that resolves once a change asks
   * for such a turn after that call, holding it or waiting behind the change that holds it: the
   * proof that it passed every check made before the turn, so one that settles it afterwards was
   * decided in the turn.
   */
  const watchQueue = (turns: 'ofTenants' | 'ofIdentity' = 'ofTenants') => {
    const asked = vi.spyOn(MembershipTurns.prototype, turns)

    cleanups.push(async () => asked.mockRestore())

    return {
      untilQueued: () => {
        const before = asked.mock.calls.length

        return vi.waitFor(
          () => {
            expect(asked.mock.calls.length).toBeGreaterThan(before)
          },
          { timeout: 5_000, interval: 1 },
        )
      },
    }
  }

  return {
    organisations,
    opened,
    directory,
    databases,
    clock,
    heard,
    steps,
    ann,
    bob,
    cat,
    membersIn,
    memberRolesIn,
    rolesOf,
    clearMembers,
    forgetMember,
    founded,
    invited,
    refuseInTenants,
    holdInTenants,
    holdDirectory,
    onDirectoryQuery,
    letRerole,
    retold,
    watchQueue,
  }
}

/** Lets every promise callback queued so far, and those they queue, run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Ann founded acme, and bob joined it as a member; nobody has been told of it yet. */
async function withBob() {
  const setup = await harness()
  const acme = await setup.founded()

  await setup.invited('bob@example.test')
  setup.heard.splice(0)

  return { ...setup, acme }
}

/**
 * A listener of `organisations` that keeps every list it is given in `heard` and fails to hear
 * the first one, rejecting or throwing as `how` says; it hears every later one.
 */
function deafOnce(organisations: Organisations, how: 'rejects' | 'throws') {
  const heard: Array<readonly [IdentityId, readonly Membership[]]> = []
  let deaf = true

  organisations.onChange((identity, memberships) => {
    heard.push([identity, memberships])

    if (!deaf) {
      return Promise.resolve()
    }

    deaf = false

    if (how === 'throws') {
      throw new Error('the registry is down')
    }

    return Promise.reject(new Error('the registry is down'))
  })

  return heard
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

  it('a creation whose listeners failed to hear it answers the membership, and they hear it after the delay; asking again answers the stored name', async () => {
    const { organisations, ann, bob, directory, heard, membersIn, retold } = await harness()
    const deaf = deafOnce(organisations, 'rejects')

    const created = (
      await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()

    expect(created).toMatchObject({ tenant: { key: 'acme', name: 'Acme' }, role: 'admin' })
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    // The listener that heard it keeps the list; the one that did not is told again after the delay.
    expect(heard).toEqual([[ann.id, [created]]])
    expect(deaf).toEqual([[ann.id, [created]]])

    await retold()

    expect(heard).toEqual([
      [ann.id, [created]],
      [ann.id, [created]],
    ])
    expect(deaf).toEqual([
      [ann.id, [created]],
      [ann.id, [created]],
    ])
    heard.splice(0)

    // The creator asking again gets the organisation as it was made, whatever name it sends.
    expect(
      await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme again' }),
    ).toEqual(ok(created))
    expect(heard).toEqual([[ann.id, [created]]])
    expect(
      (
        await organisations.create({ identity: bob.id, key: 'acme', name: 'Acme' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('key-taken'))

    // A creator no longer in the organisation finds the key taken like anybody else.
    await directory.db.query(membershipRemoveStatement, {
      identity: recordId('identity', ann.id),
      tenant: recordId('tenant', created.tenant.id),
    })
    expect(
      (
        await organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('key-taken'))
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

  it('a removal whose memberships reread fails still revokes the region, answers ok, and tells the removed device after the delay', async () => {
    const {
      organisations,
      ann,
      bob,
      heard,
      steps,
      membersIn,
      founded,
      invited,
      onDirectoryQuery,
      retold,
    } = await harness()

    await founded()
    await invited('bob@example.test')
    heard.splice(0)

    // The directory goes away for a moment once the membership is deleted.
    onDirectoryQuery(readFailingAfter(membershipRemoveStatement))

    expect(await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })).toEqual(
      ok(undefined),
    )
    // Bob's connections lost the region before the member row went, though nobody could be
    // told the memberships yet.
    expect(steps).toEqual([`revoke ${bob.id} tenant:acme`, 'member-remove'])
    expect(heard).toEqual([])
    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([]))
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])

    await retold()

    expect(heard).toEqual([[bob.id, []]])
  })

  it('a removal paused before its tenant step and a concurrent acceptance by the same identity end in a consistent state', async () => {
    const {
      organisations,
      ann,
      bob,
      heard,
      steps,
      membersIn,
      founded,
      holdInTenants,
      onDirectoryQuery,
      watchQueue,
    } = await harness()
    const acme = await founded()
    const invitation = (
      await organisations.invitations.invite({
        actor: ann.id,
        key: 'acme',
        email: 'bob@example.test',
        role: 'member',
      })
    )._unsafeUnwrap()

    heard.splice(0)

    const held = holdInTenants(memberRemoveStatement)
    const removal = organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })

    await held.waiting

    const directorySteps: string[] = []

    onDirectoryQuery((text) => {
      directorySteps.push(text)
    })

    const asked = watchQueue('ofIdentity').untilQueued()
    const accepting = organisations.invitations.accept({
      identity: bob.id,
      invitation: invitation.id,
    })

    // The acceptance asked for bob's turn, which the removal holds: it writes no membership
    // meanwhile.
    await asked
    expect(directorySteps).not.toContain(invitationAcceptStatement)

    held.release()

    expect(await removal).toEqual(ok(undefined))
    expect((await accepting)._unsafeUnwrap()).toEqual({ tenant: acme.tenant, role: 'member' })

    const joined: Membership = { tenant: acme.tenant, role: 'member' }

    // Removed, then accepted: the directory and the organisation's database agree.
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

  it('an acceptance by an identity waits for its departure under way, which revokes nothing and tells nobody', async () => {
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
      watchQueue,
    } = await harness()

    await founded()

    const zeta = await founded('zeta', 'Zeta')

    await invited('bob@example.test')

    const invitation = (
      await organisations.invitations.invite({
        actor: ann.id,
        key: 'zeta',
        email: 'bob@example.test',
        role: 'member',
      })
    )._unsafeUnwrap()

    heard.splice(0)

    const held = holdInTenants(memberRemoveStatement)
    const departure = organisations.leaveAll(bob.id)

    await held.waiting

    const directorySteps: string[] = []

    onDirectoryQuery((text) => {
      directorySteps.push(text)
    })

    const asked = watchQueue('ofIdentity').untilQueued()
    const accepting = organisations.invitations.accept({
      identity: bob.id,
      invitation: invitation.id,
    })

    // The acceptance asked for bob's turn, which the departure holds: it writes no membership
    // meanwhile.
    await asked
    expect(directorySteps).not.toContain(invitationAcceptStatement)

    held.release()

    expect(await departure).toEqual(ok(undefined))
    expect((await accepting)._unsafeUnwrap()).toEqual({ tenant: zeta.tenant, role: 'member' })

    const joined: Membership = { tenant: zeta.tenant, role: 'member' }

    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([joined]))
    expect(await membersIn('acme')).toEqual([{ identity: ann.id, role: 'admin' }])
    expect(await membersIn('zeta')).toEqual([
      { identity: ann.id, role: 'admin' },
      { identity: bob.id, role: 'member' },
    ])
    // Only the acceptance told bob's listeners; the departure took no region from any connection.
    expect(heard).toEqual([[bob.id, [joined]]])
    expect(steps).toEqual(['member-remove'])
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

  it('lists memberships ordered by key, only of ready tenants', async () => {
    const { organisations, ann, directory, founded } = await harness()
    const globex = await founded('globex', 'Globex')
    const acme = await founded()

    await founded('initech', 'Initech')
    await directory.db.query(tenantInterrupt, { key: 'initech' })

    expect(await organisations.membershipsOf(ann.id)).toEqual(ok([acme, globex]))
  })
})

describe('Organisations.setRole', () => {
  /** Bob is an admin of acme too, as ann made him. */
  const withTwoAdmins = async () => {
    const setup = await withBob()

    expect(
      await setup.organisations.setRole({
        actor: setup.ann.id,
        key: 'acme',
        identity: setup.bob.id,
        role: 'admin',
      }),
    ).toEqual(ok(undefined))
    setup.heard.splice(0)

    return setup
  }

  it("promotes a member: the directory, the member row and the promoted identity's listeners all say admin", async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf } = await withBob()

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'admin' })
    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'admin' }]]])
  })

  it('demotes another admin to member, and tells the demoted identity, not the actor', async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf } = await withTwoAdmins()

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'member' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'member' }]]])
  })

  it('lets an admin demote itself while another admin stays', async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf } = await withTwoAdmins()

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: ann.id, role: 'member' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', ann.id)).toEqual(['member'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'member', [bob.id]: 'admin' })
    expect(heard).toEqual([[ann.id, [{ tenant: acme.tenant, role: 'member' }]]])
  })

  it('refuses the only admin demoting itself `last-admin`, leaving every role as it was and telling nobody', async () => {
    const { organisations, ann, bob, heard, memberRolesIn, rolesOf } = await withBob()

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: ann.id,
          role: 'member',
        })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('last-admin'))
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(heard).toEqual([])
  })

  it("re-judges the identity's live connections right after the directory write, before the telling", async () => {
    const { organisations, ann, bob, steps, onDirectoryQuery } = await withBob()

    organisations.onChange(async () => {
      steps.push('told')
    })
    onDirectoryQuery((text) => {
      if (text === membershipSetRoleStatement) {
        steps.push('directory write')
      }
    })

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    expect(steps).toEqual(['directory write', `rerole ${bob.id} tenant:acme admin`, 'told'])
  })

  it('re-judges a role written again, and no connection for a change that is refused', async () => {
    const { organisations, ann, bob, cat, steps } = await withBob()
    const set = (actor: IdentityId, identity: IdentityId, role: 'member' | 'admin') =>
      organisations.setRole({ actor, key: 'acme', identity, role })

    expect(await set(ann.id, bob.id, 'member')).toEqual(ok(undefined))
    expect(steps).toEqual([`rerole ${bob.id} tenant:acme member`])
    steps.splice(0)

    expect((await set(ann.id, ann.id, 'member'))._unsafeUnwrapErr()).toEqual(refused('last-admin'))
    expect((await set(ann.id, cat.id, 'admin'))._unsafeUnwrapErr()).toEqual(
      refused('no-such-member'),
    )
    expect((await set(bob.id, bob.id, 'admin'))._unsafeUnwrapErr()).toEqual(refused('not-admin'))
    expect(steps).toEqual([])
  })

  it('a change whose connections fail to be re-judged answers failed, telling nobody, and asking again completes it', async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf, letRerole } =
      await withBob()

    letRerole(false)

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: bob.id,
          role: 'admin',
        })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    // Both rows were written before.
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'admin' })
    expect(heard).toEqual([])

    letRerole(true)

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'admin' }]]])
  })

  it('refuses a member changing a role, an outsider and an unknown organisation', async () => {
    const { organisations, ann, bob, cat, heard, memberRolesIn } = await withBob()
    const set = async (actor: IdentityId, key: string) =>
      (
        await organisations.setRole({ actor, key, identity: bob.id, role: 'admin' })
      )._unsafeUnwrapErr()

    expect(await set(bob.id, 'acme')).toEqual(refused('not-admin'))
    expect(await set(cat.id, 'acme')).toEqual(refused('not-a-member'))
    expect(await set(ann.id, 'globex')).toEqual(refused('no-such-tenant'))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(heard).toEqual([])
  })

  it('refuses a target that is no member `no-such-member`, writing nothing and telling nobody', async () => {
    const { organisations, ann, cat, heard, memberRolesIn, rolesOf } = await withBob()

    expect(
      (
        await organisations.setRole({ actor: ann.id, key: 'acme', identity: cat.id, role: 'admin' })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('no-such-member'))
    expect(await rolesOf('acme', cat.id)).toEqual([])
    expect(Object.keys(await memberRolesIn('acme'))).not.toContain(cat.id)
    expect(heard).toEqual([])
  })

  it('writes and tells the same role again, restoring a member row that was lost', async () => {
    const { organisations, ann, bob, acme, heard, forgetMember, memberRolesIn, rolesOf } =
      await withBob()

    await forgetMember('acme', bob.id)

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'member' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'member' }]]])
  })

  it('decides on the directory: a lost member row of the only admin changes nothing about who is the last admin, and the refusal writes it again as the directory has it', async () => {
    const { organisations, ann, bob, forgetMember, memberRolesIn, rolesOf } = await withBob()

    await forgetMember('acme', ann.id)

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: ann.id,
          role: 'member',
        })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('last-admin'))
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
  })

  it('a `last-admin` refusal whose restore of the member row fails answers that failure, telling nobody', async () => {
    const { organisations, ann, heard, forgetMember, memberRolesIn, refuseInTenants } =
      await withBob()

    await forgetMember('acme', ann.id)
    refuseInTenants(memberAddStatement)

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: ann.id,
          role: 'member',
        })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    expect(Object.keys(await memberRolesIn('acme'))).not.toContain(ann.id)
    expect(heard).toEqual([])
  })

  it('a change whose member row cannot be written leaves the directory as it was, and asking again redoes it', async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf, refuseInTenants } =
      await withBob()

    refuseInTenants(memberAddStatement)

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: bob.id,
          role: 'admin',
        })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
    expect(heard).toEqual([])

    refuseInTenants(undefined)

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'admin' })
    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'admin' }]]])
  })

  it('a self-demotion whose directory write fails after the member row was written answers failed, and asking again completes it', async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf, onDirectoryQuery } =
      await withTwoAdmins()

    onDirectoryQuery((text) => {
      if (text === membershipSetRoleStatement) {
        throw new Error('the directory refused the write')
      }
    })

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: ann.id,
          role: 'member',
        })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    // The member row went first; the directory, the authority, still says admin.
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'member', [bob.id]: 'admin' })
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(heard).toEqual([])

    onDirectoryQuery(undefined)

    // Ann is still an admin to the directory, so she can ask again.
    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: ann.id, role: 'member' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', ann.id)).toEqual(['member'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'member', [bob.id]: 'admin' })
    expect(heard).toEqual([[ann.id, [{ tenant: acme.tenant, role: 'member' }]]])
  })

  it("a self-demotion that failed at the directory, then the other admin's self-demotion: the retry is refused `last-admin` and its member row says admin again", async () => {
    const { organisations, ann, bob, heard, memberRolesIn, rolesOf, onDirectoryQuery } =
      await withTwoAdmins()

    onDirectoryQuery((text) => {
      if (text === membershipSetRoleStatement) {
        throw new Error('the directory refused the write')
      }
    })

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: ann.id,
          role: 'member',
        })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    onDirectoryQuery(undefined)
    // Half done: ann's member row says member, the directory still counts her an admin.
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'member', [bob.id]: 'admin' })

    expect(
      await organisations.setRole({ actor: bob.id, key: 'acme', identity: bob.id, role: 'member' }),
    ).toEqual(ok(undefined))
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'member', [bob.id]: 'member' })
    heard.splice(0)

    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: ann.id,
          role: 'member',
        })
      )._unsafeUnwrapErr(),
    ).toEqual(refused('last-admin'))
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(heard).toEqual([])
  })

  it("another admin's demotion whose listeners fail to hear it answers ok, and they hear it after the delay", async () => {
    const { organisations, ann, bob, acme, heard, memberRolesIn, rolesOf, retold } =
      await withTwoAdmins()
    const deaf = deafOnce(organisations, 'rejects')
    const demoted: Membership = { tenant: acme.tenant, role: 'member' }

    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'member' }),
    ).toEqual(ok(undefined))
    // Both rows were written before the telling.
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(heard).toEqual([[bob.id, [demoted]]])
    expect(deaf).toEqual([[bob.id, [demoted]]])

    await retold()

    expect(heard).toEqual([
      [bob.id, [demoted]],
      [bob.id, [demoted]],
    ])
    expect(deaf).toEqual([
      [bob.id, [demoted]],
      [bob.id, [demoted]],
    ])
  })

  it('two admins demoting each other at once: one succeeds, the other is no admin by its turn and is refused `not-admin`, one admin stays', async () => {
    const {
      organisations,
      ann,
      bob,
      acme,
      heard,
      memberRolesIn,
      rolesOf,
      holdInTenants,
      forgetMember,
      watchQueue,
    } = await withTwoAdmins()
    const queue = watchQueue()

    // Ann's member row is lost: a refusal about authorization writes nothing back for it.
    await forgetMember('acme', ann.id)

    const held = holdInTenants(memberAddStatement)
    const first = organisations.setRole({
      actor: ann.id,
      key: 'acme',
      identity: bob.id,
      role: 'member',
    })

    await held.waiting

    // Bob found himself an admin before ann's change wrote anything, and waits for its turn:
    // once he is queued behind it, only the check made in his turn can refuse him.
    const queued = queue.untilQueued()
    const second = organisations.setRole({
      actor: bob.id,
      key: 'acme',
      identity: ann.id,
      role: 'member',
    })

    await queued
    held.release()

    expect(await first).toEqual(ok(undefined))
    expect((await second)._unsafeUnwrapErr()).toEqual(refused('not-admin'))
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
    expect(await memberRolesIn('acme')).toEqual({ [bob.id]: 'member' })
    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'member' }]]])
  })

  it("a self-demotion first and the other admin's departure at once: the departure is refused `last-admin`, an admin stays", async () => {
    const { organisations, ann, bob, acme, heard, rolesOf, holdInTenants, watchQueue } =
      await withTwoAdmins()
    const queue = watchQueue()
    const held = holdInTenants(memberAddStatement)
    const demotion = organisations.setRole({
      actor: ann.id,
      key: 'acme',
      identity: ann.id,
      role: 'member',
    })

    await held.waiting

    const queued = queue.untilQueued()
    const departure = organisations.leaveAll(bob.id)

    await queued
    held.release()

    expect(await demotion).toEqual(ok(undefined))
    expect((await departure)._unsafeUnwrapErr()).toEqual({ kind: 'refused', code: 'last-admin' })
    expect(await rolesOf('acme', ann.id)).toEqual(['member'])
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(heard).toEqual([[ann.id, [{ tenant: acme.tenant, role: 'member' }]]])
  })

  it("the other admin's departure first and a self-demotion at once: the demotion is refused `last-admin`, an admin stays", async () => {
    const { organisations, ann, bob, heard, rolesOf, holdInTenants, watchQueue } =
      await withTwoAdmins()
    const queue = watchQueue()
    const held = holdInTenants(memberRemoveStatement)
    const departure = organisations.leaveAll(bob.id)

    await held.waiting

    const queued = queue.untilQueued()
    const demotion = organisations.setRole({
      actor: ann.id,
      key: 'acme',
      identity: ann.id,
      role: 'member',
    })

    await queued
    held.release()

    expect(await departure).toEqual(ok(undefined))
    expect((await demotion)._unsafeUnwrapErr()).toEqual(refused('last-admin'))
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await rolesOf('acme', bob.id)).toEqual([])
    expect(heard).toEqual([])
  })
})

describe('Organisations, a failed tell', () => {
  type Joined = Awaited<ReturnType<typeof withBob>>

  /** What a change left: whose memberships, the list the directory holds, the member rows. */
  interface Left {
    readonly identity: IdentityId
    readonly memberships: readonly Membership[]
    readonly rows: Readonly<Record<string, Readonly<Record<string, string>>>>
  }

  /** The changes, each from acme founded by ann with bob a member, with its directory statement. */
  const changes: ReadonlyArray<readonly [string, string, (setup: Joined) => Promise<Left>]> = [
    [
      'a creation',
      tenantReadyStatement,
      async ({ organisations, ann, bob, acme }) => {
        const zeta = (
          await organisations.create({ identity: ann.id, key: 'zeta', name: 'Zeta' })
        )._unsafeUnwrap()

        expect(zeta).toMatchObject({ tenant: { key: 'zeta', name: 'Zeta' }, role: 'admin' })

        return {
          identity: ann.id,
          memberships: [acme, zeta],
          rows: { acme: { [ann.id]: 'admin', [bob.id]: 'member' }, zeta: { [ann.id]: 'admin' } },
        }
      },
    ],
    [
      'a role change',
      membershipSetRoleStatement,
      async ({ organisations, ann, bob, acme }) => {
        expect(
          await organisations.setRole({
            actor: ann.id,
            key: 'acme',
            identity: bob.id,
            role: 'admin',
          }),
        ).toEqual(ok(undefined))

        return {
          identity: bob.id,
          memberships: [{ tenant: acme.tenant, role: 'admin' }],
          rows: { acme: { [ann.id]: 'admin', [bob.id]: 'admin' } },
        }
      },
    ],
    [
      'a removal',
      membershipRemoveStatement,
      async ({ organisations, ann, bob }) => {
        expect(
          await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id }),
        ).toEqual(ok(undefined))

        return { identity: bob.id, memberships: [], rows: { acme: { [ann.id]: 'admin' } } }
      },
    ],
  ]

  /** The member rows of each organisation `left` names hold the directory's roles. */
  const rowsAsLeft = async ({ memberRolesIn, organisations }: Joined, left: Left) => {
    for (const [key, roles] of Object.entries(left.rows)) {
      expect(await memberRolesIn(key)).toEqual(roles)
    }

    expect(await organisations.membershipsOf(left.identity)).toEqual(ok(left.memberships))
  }

  describe.each(changes)('%s', (_, statement, change) => {
    it('whose memberships read fails once after the commit succeeds, and the listeners hear the list after the delay', async () => {
      const setup = await withBob()
      const { heard, onDirectoryQuery, retold } = setup

      onDirectoryQuery(readFailingAfter(statement))

      const left = await change(setup)

      await rowsAsLeft(setup, left)
      expect(heard).toEqual([])

      await retold()

      expect(heard).toEqual([[left.identity, left.memberships]])
    })

    it.each(['rejects', 'throws'] as const)(
      'whose listener %s once succeeds: the others hear the list at once, and every one after the delay',
      async (how) => {
        const setup = await withBob()
        const { organisations, heard, retold } = setup
        const deaf = deafOnce(organisations, how)

        const left = await change(setup)
        const told = [left.identity, left.memberships] as const

        await rowsAsLeft(setup, left)
        // Waiting for every listener undoes no delivery: the one that heard keeps the list.
        expect(heard).toEqual([told])
        expect(deaf).toEqual([told])

        await retold()

        expect(heard).toEqual([told, told])
        expect(deaf).toEqual([told, told])
      },
    )
  })

  it('a removal whose member-row delete and tell both fail answers the delete failure, and is retold', async () => {
    const {
      organisations,
      ann,
      bob,
      heard,
      steps,
      membersIn,
      refuseInTenants,
      onDirectoryQuery,
      retold,
    } = await withBob()

    refuseInTenants(memberRemoveStatement)
    onDirectoryQuery(readFailingAfter(membershipRemoveStatement))

    const failed = await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })

    expect(failed._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(steps).toEqual([`revoke ${bob.id} tenant:acme`, 'member-remove'])
    expect(await organisations.membershipsOf(bob.id)).toEqual(ok([]))
    expect(await membersIn('acme')).toHaveLength(2)
    expect(heard).toEqual([])

    await retold()

    expect(heard).toEqual([[bob.id, []]])
  })

  it('a slow listener holds the turn: the next change of the identity runs after it and its list reaches the listener after the older one', async () => {
    const {
      organisations,
      ann,
      bob,
      acme,
      heard,
      clock,
      rolesOf,
      memberRolesIn,
      onDirectoryQuery,
      watchQueue,
    } = await withBob()
    const slow: Array<readonly [IdentityId, readonly Membership[]]> = []
    const written: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = true

    organisations.onChange(async (identity, memberships) => {
      slow.push([identity, memberships])

      if (held) {
        held = false
        await gate
      }
    })
    deafOnce(organisations, 'rejects')
    onDirectoryQuery((text) => {
      if (text === membershipSetRoleStatement) {
        written.push(text)
      }
    })

    const promoted: Membership = { tenant: acme.tenant, role: 'admin' }
    const demoted: Membership = { tenant: acme.tenant, role: 'member' }
    const queue = watchQueue('ofIdentity')
    const first = organisations.setRole({
      actor: ann.id,
      key: 'acme',
      identity: bob.id,
      role: 'admin',
    })

    await vi.waitFor(() => expect(slow).toEqual([[bob.id, [promoted]]]))

    // The second change asked for bob's turn, which the first holds while its slow listener
    // has not settled: it writes nothing meanwhile, though another listener failed at once.
    const queued = queue.untilQueued()
    const second = organisations.setRole({
      actor: ann.id,
      key: 'acme',
      identity: bob.id,
      role: 'member',
    })

    await queued
    await flush()
    expect(written).toHaveLength(1)
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'admin' })

    release()

    expect(await first).toEqual(ok(undefined))
    expect(await second).toEqual(ok(undefined))
    expect(written).toHaveLength(2)
    expect(slow).toEqual([
      [bob.id, [promoted]],
      [bob.id, [demoted]],
    ])
    expect(heard).toEqual([
      [bob.id, [promoted]],
      [bob.id, [demoted]],
    ])
    // The second change's tell succeeded: nothing is left to retell.
    expect(clock.pending()).toBe(0)
  })

  it('a retell due before a change of the identity runs first, and the listeners hear the lists in turn order', async () => {
    const { organisations, ann, bob, acme, heard, clock, onDirectoryQuery } = await withBob()

    onDirectoryQuery(readFailingAfter(membershipSetRoleStatement))
    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    expect(heard).toEqual([])
    onDirectoryQuery(undefined)

    // The re-tell took bob's turn; the removal asks for it right after and waits.
    await clock.advance(1_200)

    expect(await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })).toEqual(
      ok(undefined),
    )
    expect(heard).toEqual([
      [bob.id, [{ tenant: acme.tenant, role: 'admin' }]],
      [bob.id, []],
    ])
    expect(clock.pending()).toBe(0)
  })

  it('a change of the identity holding its turn when a retell is due runs first, and the retell then does nothing', async () => {
    const { organisations, ann, bob, heard, clock, holdInTenants, onDirectoryQuery } =
      await withBob()

    onDirectoryQuery(readFailingAfter(membershipSetRoleStatement))
    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    expect(heard).toEqual([])
    onDirectoryQuery(undefined)

    const held = holdInTenants(memberRemoveStatement)
    const removal = organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })

    await held.waiting
    // The re-tell is due while the removal holds bob's turn: it queues behind it.
    await clock.advance(1_200)
    expect(heard).toEqual([])

    held.release()

    expect(await removal).toEqual(ok(undefined))
    await flush()

    // The removal's tell succeeded, so the re-tell found its entry gone: no older list last.
    expect(heard).toEqual([[bob.id, []]])
    expect(clock.pending()).toBe(0)

    await clock.advance(60_000)
    await flush()
    expect(heard).toEqual([[bob.id, []]])
  })

  it('a retell after a completed departure tells an empty list', async () => {
    const { organisations, ann, bob, heard, onDirectoryQuery, retold } = await withBob()

    onDirectoryQuery(readFailingAfter(membershipSetRoleStatement))
    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))
    onDirectoryQuery(undefined)

    expect(await organisations.leaveAll(bob.id)).toEqual(ok(undefined))
    expect(heard).toEqual([])

    await retold()

    expect(heard).toEqual([[bob.id, []]])
  })

  it("a retell after a departure that failed between its deletes tells the directory's list", async () => {
    const {
      organisations,
      ann,
      bob,
      acme,
      heard,
      memberRolesIn,
      rolesOf,
      onDirectoryQuery,
      retold,
    } = await withBob()

    onDirectoryQuery(readFailingAfter(membershipSetRoleStatement))
    expect(
      await organisations.setRole({ actor: ann.id, key: 'acme', identity: bob.id, role: 'admin' }),
    ).toEqual(ok(undefined))

    // The member row goes, then the directory refuses to delete the membership.
    onDirectoryQuery((text) => {
      if (text === membershipRemoveStatement) {
        throw new Error('the directory refused the delete')
      }
    })
    expect((await organisations.leaveAll(bob.id))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(heard).toEqual([])
    onDirectoryQuery(undefined)

    await retold()

    expect(heard).toEqual([[bob.id, [{ tenant: acme.tenant, role: 'admin' }]]])
  })
})

describe('OrganisationAdmission', () => {
  it('writes the membership and the member row of an admitted identity with the role it is given', async () => {
    const { ann, bob, directory, databases, memberRolesIn, rolesOf, founded } = await harness()
    const acme = await founded()

    const admission = new OrganisationAdmission({
      directory,
      lookup: new OrganisationLookup(directory),
      members: new TenantMembers(databases),
    })

    expect((await admission.admit(acme.tenant, bob.id, 'admin')).isOk()).toBe(true)
    expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'admin' })
  })

  it('refuses an identity already in `already-member` once its member row is restored with the directory role', async () => {
    const { ann, bob, directory, databases, memberRolesIn, rolesOf, forgetMember, founded } =
      await harness()
    const acme = await founded()

    await forgetMember('acme', ann.id)

    const admission = new OrganisationAdmission({
      directory,
      lookup: new OrganisationLookup(directory),
      members: new TenantMembers(databases),
    })

    expect((await admission.admit(acme.tenant, bob.id, 'member')).isOk()).toBe(true)
    // Asked again for the founder with another role: the directory's role wins.
    expect((await admission.admit(acme.tenant, ann.id, 'member'))._unsafeUnwrapErr()).toEqual(
      refused('already-member'),
    )
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
  })
})

describe('the members list', () => {
  type Setup = Awaited<ReturnType<typeof harness>>

  /** What ann, the admin of acme, is asked for its members. */
  const listed = (setup: Pick<Setup, 'organisations' | 'ann'>) =>
    setup.organisations.membersOf({ actor: setup.ann.id, key: 'acme' })

  /** The members a list answers: each account with its email and its role. */
  const members = (...entries: ReadonlyArray<readonly [AuthUser, TenantRole]>) =>
    ok(
      entries.map(([account, role]) => ({
        identity: { id: account.id, email: account.email },
        role,
      })),
    )

  /** Writes the member row of `identity` as a change that was interrupted would leave it. */
  const rowOf = async (setup: Setup, identity: IdentityId, role: TenantRole) =>
    (await new TenantMembers(setup.databases).add('acme', identity, role))._unsafeUnwrap()

  it('lists the members with their emails for an admin, not for a member nor an outsider', async () => {
    const { organisations, ann, bob, cat, founded, invited } = await harness()

    await founded()
    await invited('bob@example.test')

    expect(await organisations.membersOf({ actor: ann.id, key: 'acme' })).toEqual(
      members([ann, 'admin'], [bob, 'member']),
    )
    expect(
      (await organisations.membersOf({ actor: bob.id, key: 'acme' }))._unsafeUnwrapErr(),
    ).toEqual(refused('not-admin'))
    expect(
      (await organisations.membersOf({ actor: cat.id, key: 'acme' }))._unsafeUnwrapErr(),
    ).toEqual(refused('not-a-member'))
  })

  it('refuses an organisation still provisioning', async () => {
    const setup = await harness()

    await setup.founded()
    await setup.directory.db.query(tenantInterrupt, { key: 'acme' })

    expect((await listed(setup))._unsafeUnwrapErr()).toEqual(refused('no-such-tenant'))
  })

  it('deletes the member row of a removal whose member-row delete failed', async () => {
    const setup = await withBob()
    const { organisations, ann, bob, refuseInTenants, memberRolesIn, rolesOf } = setup

    refuseInTenants(memberRemoveStatement)
    expect(
      (
        await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    refuseInTenants(undefined)
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })

    expect(await listed(setup)).toEqual(members([ann, 'admin']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
    expect(await rolesOf('acme', bob.id)).toEqual([])
  })

  it('deletes the member row of an accept whose directory transaction failed, and its invitation stays live', async () => {
    const setup = await harness()
    const { organisations, ann, bob, onDirectoryQuery, memberRolesIn, rolesOf } = setup

    await setup.founded()

    const invitation = (
      await organisations.invitations.invite({
        actor: ann.id,
        key: 'acme',
        email: 'bob@example.test',
        role: 'member',
      })
    )._unsafeUnwrap()

    onDirectoryQuery((text) => {
      if (text === invitationAcceptStatement) {
        throw new Error('the directory refused the transaction')
      }
    })
    expect(
      (
        await organisations.invitations.accept({ identity: bob.id, invitation: invitation.id })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    onDirectoryQuery(undefined)
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })

    expect(await listed(setup)).toEqual(members([ann, 'admin']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
    expect(await rolesOf('acme', bob.id)).toEqual([])
    expect(
      (await organisations.invitations.pending({ actor: ann.id, key: 'acme' }))._unsafeUnwrap(),
    ).toHaveLength(1)
  })

  it('writes the directory role back into the member row of a role change whose directory write failed', async () => {
    const setup = await withBob()
    const { organisations, ann, bob, onDirectoryQuery, memberRolesIn, rolesOf } = setup

    onDirectoryQuery((text) => {
      if (text === membershipSetRoleStatement) {
        throw new Error('the directory refused the write')
      }
    })
    expect(
      (
        await organisations.setRole({
          actor: ann.id,
          key: 'acme',
          identity: bob.id,
          role: 'admin',
        })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_FAILED' })
    onDirectoryQuery(undefined)
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'admin' })

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
  })

  it('lists a member whose departure failed at the directory after its member row went, and writes its row again', async () => {
    const setup = await withBob()
    const { organisations, ann, bob, onDirectoryQuery, memberRolesIn, rolesOf } = setup

    onDirectoryQuery((text) => {
      if (text === membershipRemoveStatement) {
        throw new Error('the directory refused the delete')
      }
    })
    expect((await organisations.leaveAll(bob.id))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    onDirectoryQuery(undefined)
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
  })

  it('deletes a member row no membership wants', async () => {
    const setup = await withBob()
    const { ann, bob, cat, memberRolesIn, rolesOf } = setup

    await rowOf(setup, cat.id, 'admin')
    expect(await memberRolesIn('acme')).toMatchObject({ [cat.id]: 'admin' })

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(await rolesOf('acme', cat.id)).toEqual([])
  })

  it('keeps the row of a membership whose identity is gone and leaves it out', async () => {
    const setup = await withBob()
    const { ann, bob, directory, memberRolesIn, rolesOf } = setup

    await directory.db.query(identityForget, { identity: recordId('identity', bob.id) })

    expect(await listed(setup)).toEqual(members([ann, 'admin']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
  })

  it('writes the missing row of a membership whose identity is gone too', async () => {
    const setup = await withBob()
    const { ann, bob, directory, forgetMember, memberRolesIn } = setup

    await directory.db.query(identityForget, { identity: recordId('identity', bob.id) })
    await forgetMember('acme', bob.id)

    expect(await listed(setup)).toEqual(members([ann, 'admin']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
  })

  it('lists in the order the memberships were made', async () => {
    const setup = await harness()
    const { databases, ann, bob, cat, clearMembers, founded, invited, memberRolesIn } = setup

    await founded()
    await invited('bob@example.test')
    await invited('cat@example.test')
    // The member rows are written in the reverse order: they would list cat first.
    await clearMembers('acme')
    await rowOf(setup, cat.id, 'member')
    await rowOf(setup, bob.id, 'member')
    await rowOf(setup, ann.id, 'admin')
    expect(
      (await new TenantMembers(databases).list('acme'))._unsafeUnwrap().map((row) => keyOf(row.id)),
    ).toEqual([cat.id, bob.id, ann.id])

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member'], [cat, 'member']))
    expect(await memberRolesIn('acme')).toEqual({
      [ann.id]: 'admin',
      [bob.id]: 'member',
      [cat.id]: 'member',
    })
  })

  it('answers data:QUERY_FAILED when the directory read fails, writing nothing, and the next read settles', async () => {
    const setup = await withBob()
    const { ann, bob, cat, onDirectoryQuery, memberRolesIn } = setup

    await rowOf(setup, cat.id, 'member')
    onDirectoryQuery((text) => {
      if (text === membershipsOfTenantStatement) {
        throw new Error('the directory went away for a moment')
      }
    })

    expect((await listed(setup))._unsafeUnwrapErr()).toMatchObject({ code: 'data:QUERY_FAILED' })
    expect(await memberRolesIn('acme')).toEqual({
      [ann.id]: 'admin',
      [bob.id]: 'member',
      [cat.id]: 'member',
    })

    onDirectoryQuery(undefined)

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
  })

  it('answers data:WRITE_FAILED when a row cannot be written, stops there, and the next read settles', async () => {
    const setup = await withBob()
    const { ann, bob, cat, forgetMember, refuseInTenants, memberRolesIn } = setup

    await forgetMember('acme', bob.id)
    await rowOf(setup, cat.id, 'member')
    refuseInTenants(memberAddStatement)

    expect((await listed(setup))._unsafeUnwrapErr()).toMatchObject({ code: 'data:WRITE_FAILED' })
    // The writes go one after the other, the first failure answering: the delete that follows
    // the failed write was not tried.
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [cat.id]: 'member' })

    refuseInTenants(undefined)

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
  })

  it('answers data:WRITE_FAILED when a row cannot be deleted, and the next read settles', async () => {
    const setup = await withBob()
    const { ann, bob, cat, refuseInTenants, memberRolesIn } = setup

    await rowOf(setup, cat.id, 'member')
    refuseInTenants(memberRemoveStatement)

    expect((await listed(setup))._unsafeUnwrapErr()).toMatchObject({ code: 'data:WRITE_FAILED' })
    expect(await memberRolesIn('acme')).toMatchObject({ [cat.id]: 'member' })

    refuseInTenants(undefined)

    expect(await listed(setup)).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
  })

  it('waits for an accept paused between its member row and its directory transaction', async () => {
    const setup = await harness()
    const { organisations, ann, bob, holdDirectory, watchQueue, memberRolesIn, rolesOf } = setup

    await setup.founded()

    const invitation = (
      await organisations.invitations.invite({
        actor: ann.id,
        key: 'acme',
        email: 'bob@example.test',
        role: 'member',
      })
    )._unsafeUnwrap()
    const held = holdDirectory(invitationAcceptStatement)
    const accepting = organisations.invitations.accept({
      identity: bob.id,
      invitation: invitation.id,
    })

    await held.reached

    const queued = watchQueue().untilQueued()
    const listing = listed(setup)

    // The list passed its checks and waits for the organisation's turn, which the accept holds:
    // the member row the accept wrote is not deleted meanwhile.
    await queued
    await flush()
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })

    held.release()

    expect((await accepting).isOk()).toBe(true)
    expect(await listing).toEqual(members([ann, 'admin'], [bob, 'member']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin', [bob.id]: 'member' })
    expect(await rolesOf('acme', bob.id)).toEqual(['member'])
  })

  it('waits for a departure paused between its member-row delete and its membership delete', async () => {
    const setup = await withBob()
    const { organisations, ann, bob, holdDirectory, watchQueue, memberRolesIn, rolesOf } = setup
    const held = holdDirectory(membershipRemoveStatement)
    const departure = organisations.leaveAll(bob.id)

    await held.reached
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })

    const queued = watchQueue().untilQueued()
    const listing = listed(setup)

    // The list waits for the departure's turn: it does not write bob's row again between the
    // two deletes, which would leave a row no membership wants.
    await queued
    await flush()
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })

    held.release()

    expect(await departure).toEqual(ok(undefined))
    expect(await listing).toEqual(members([ann, 'admin']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
    expect(await rolesOf('acme', bob.id)).toEqual([])
  })

  it('waits for an organisation removed whole, and finds it gone', async () => {
    const setup = await harness()
    const { organisations, ann, directory, holdDirectory, watchQueue } = setup

    await setup.founded()

    const held = holdDirectory(tenantRemoveStatement)
    const departure = organisations.leaveAll(ann.id)

    await held.reached

    const queued = watchQueue().untilQueued()
    const listing = listed(setup)

    await queued
    held.release()

    expect(await departure).toEqual(ok(undefined))
    expect((await listing)._unsafeUnwrapErr()).toEqual(refused('no-such-tenant'))

    const [tenants, memberships] = await directory.db.query<[unknown[], unknown[]]>(directoryRows)

    expect(tenants).toEqual([])
    expect(memberships).toEqual([])
  })

  it('a repeated creation of a ready organisation beside a list read leaves the rows equal to the directory', async () => {
    const setup = await harness()
    const { organisations, ann, forgetMember, memberRolesIn, rolesOf } = setup
    const acme = await setup.founded()

    await forgetMember('acme', ann.id)

    const [created, listing] = await Promise.all([
      organisations.create({ identity: ann.id, key: 'acme', name: 'Acme' }),
      listed(setup),
    ])

    expect(created).toEqual(ok(acme))
    expect(listing).toEqual(members([ann, 'admin']))
    expect(await memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
    expect(await rolesOf('acme', ann.id)).toEqual(['admin'])
  })
})
