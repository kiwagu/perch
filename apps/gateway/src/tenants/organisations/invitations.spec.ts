import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type DataError,
  type LocalDb,
  openLocalDb,
  recordId,
  tenantDatabase,
} from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import { type IdentityId, identityIdFactory, membershipIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'

import identityRow from '../../auth/__fixtures__/identity-row.surql'
import { DIRECTORY, NAMESPACE } from '../../config'
import identityForget from '../__fixtures__/identity-forget.surql'
import invitationRows from '../__fixtures__/invitation-rows.surql'
import { type MailedInvitation, specInvitations, specLink } from '../__fixtures__/invitations'
import memberForget from '../__fixtures__/member-forget.surql'
import memberRows from '../__fixtures__/member-rows.surql'
import membershipRows from '../__fixtures__/membership-rows.surql'
import { INVITATION_LIFETIME_MS } from '../invitations'
import { OrganisationLookup } from '../organisation-lookup'
import type { OrganisationRefusalCode } from '../organisation-refusal'
import invitationAcceptStatement from '../surql/invitation-accept.surql'
import invitationReplaceStatement from '../surql/invitation-replace.surql'
import memberAddStatement from '../surql/member-add.surql'
import membershipAddStatement from '../surql/membership-add.surql'
import { TenantDatabases } from '../tenant-databases'
import { TenantMembers } from '../tenant-members'

import { OrganisationAdmission } from './admission'
import { Organisations } from './service'
import { MembershipTurns } from './turns'

const START = Date.UTC(2026, 10, 7)

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

/** A statement held until it is let go, and the promise that says it was reached. */
function gated() {
  let release = () => {}
  let reached = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    reached = resolve
  })

  return { gate, waiting, reached, release }
}

/**
 * The invitations of organisations over an embedded directory, with each organisation's database
 * on an embedded engine of its own, a clock the test moves, and four emails: ann's (the founder),
 * bob's and cat's (accounts) and dan's (no account). A test can make a statement fail or wait, on
 * the directory or on the organisations' databases, and make the listeners fail to hear.
 */
async function harness() {
  const directory = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()
  const clock = manualClock(START)
  /** The statement the organisations' databases refuse, if any. */
  let refusedStatement: string | undefined
  /** The statement the organisations' databases hold, if any. */
  let held: { text: string; gate: Promise<void>; reached: () => void } | undefined
  /** Hears each statement sent to the directory; it may throw to fail it, or wait to hold it. */
  let directoryHook: ((text: string) => void | Promise<void>) | undefined
  /** Whether the listeners hear an identity's new memberships. */
  let hearing = true
  const databases = new TenantDatabases({
    open: (key) =>
      openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: NAMESPACE,
        database: tenantDatabase(key),
        schema: readSchema('tenant'),
      }).map((local) =>
        interceptQueries(local, (text) => {
          if (text === refusedStatement) {
            throw new Error('the database refused the statement')
          }

          if (text === held?.text) {
            held.reached()

            return held.gate
          }
        }),
      ),
    clock: manualClock(),
    onError: (error) => failures.push(error),
  })

  cleanups.push(
    () => directory.close(),
    () => databases.close(),
  )

  const watched = interceptQueries(directory, (text) => directoryHook?.(text))
  const invitations = specInvitations(watched, clock)
  const organisations = new Organisations({
    directory: watched,
    databases,
    revoke: async () => {},
    rerole: async () => {},
    hub: { retire: () => okAsync(undefined) },
    invitations,
  })
  const heard: Array<readonly [IdentityId, readonly Membership[]]> = []

  organisations.onChange(async (identity, memberships) => {
    if (!hearing) {
      throw new Error('the registry is down')
    }

    heard.push([identity, memberships])
  })

  /** An account written straight into the directory. */
  const account = async (email: string) => {
    const id = identityIdFactory.create()

    await directory.db.query(identityRow, { key: id, email })

    return { id, email }
  }
  const ann = await account('ann@example.test')
  const bob = await account('bob@example.test')
  const cat = await account('cat@example.test')
  const dan = { email: 'dan@example.test' }

  /** `creator` (ann unless named) creates the organisation `key`, for a test to start from. */
  const founded = async (key = 'acme', name = 'Acme', creator = ann) =>
    (await organisations.create({ identity: creator.id, key, name }))._unsafeUnwrap()

  /** Ann invites `email` into `key` (acme unless named) as `role`. */
  const invited = async (email: string, role: 'member' | 'admin' = 'member', key = 'acme') =>
    (await organisations.invitations.invite({ actor: ann.id, key, email, role }))._unsafeUnwrap()

  /** The mail the last invitation started. */
  const lastMailed = (): MailedInvitation => {
    const mail = invitations.mailed.at(-1)

    if (mail === undefined) {
      throw new Error('no invitation was mailed')
    }

    return mail
  }

  /** `who` (an account of the directory) joins acme through an invitation, as `role`. */
  const joined = async (
    who: { id: IdentityId; email: string },
    role: 'member' | 'admin' = 'member',
  ) => {
    const view = await invited(who.email, role)

    return (
      await organisations.invitations.accept({ identity: who.id, invitation: view.id })
    )._unsafeUnwrap()
  }

  /** The keys of the organisations and the emails of the invitations the directory holds. */
  const rows = async () => {
    const [found] =
      await directory.db.query<[Array<{ key: string; email: string }>]>(invitationRows)

    return found.map((row) => `${row.key} ${row.email}`)
  }

  /** The roles the directory holds for `identity` in the organisation with `key`. */
  const rolesOf = async (key: string, identity: IdentityId) => {
    const [found] = await directory.db.query<[Array<{ role: string }>]>(membershipRows, {
      identity: recordId('identity', identity),
      key,
    })

    return found.map((row) => row.role)
  }

  /** Runs `work` on the organisation's own database, holding it meanwhile. */
  const inTenant = async <T>(key: string, work: (local: LocalDb) => Promise<T>) => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      return await work(handle.local)
    } finally {
      handle.release()
    }
  }

  /** The roles the organisation's own database holds, by the key of the identity. */
  const memberRolesIn = (key: string) =>
    inTenant(key, async (local) => {
      const [found] = await local.db.query<[Array<{ identity: string; role: string }>]>(memberRows)

      return Object.fromEntries(found.map((row) => [row.identity, row.role]))
    })

  /** Drops the member row of `identity` from the organisation's own database. */
  const forgetMember = (key: string, identity: IdentityId) =>
    inTenant(key, (local) => local.db.query(memberForget, { identity }))

  /** Deletes the account of `identity` from the directory, as the seed's sweep does. */
  const forgetAccount = (identity: IdentityId) =>
    directory.db.query(identityForget, { identity: recordId('identity', identity) })

  /** The organisations' databases refuse `statement` from now on; `undefined` lets every one through. */
  const refuseInTenants = (statement: string | undefined) => {
    refusedStatement = statement
  }

  /** The organisations' databases hold `statement` until `release` is called. */
  const holdInTenants = (statement: string) => {
    const { gate, waiting, reached, release } = gated()

    held = { text: statement, gate, reached }

    return {
      waiting,
      release: () => {
        held = undefined
        release()
      },
    }
  }

  /** The directory holds the next `statement` until `release` is called. */
  const holdInDirectory = (statement: string) => {
    const { gate, waiting, reached, release } = gated()

    directoryHook = (text) => {
      if (text === statement) {
        directoryHook = undefined
        reached()

        return gate
      }
    }

    return { waiting, release }
  }

  /** Hears each statement sent to the directory from now on; it may throw to fail one, or wait. */
  const onDirectoryQuery = (listener: ((text: string) => void | Promise<void>) | undefined) => {
    directoryHook = listener
  }

  /** The listeners hear the memberships (the default), or fail to. */
  const letHear = (allowed: boolean) => {
    hearing = allowed
  }

  /** An admission over the same directory and databases, to make members behind the service's back. */
  const admission = new OrganisationAdmission({
    directory: watched,
    lookup: new OrganisationLookup(watched),
    members: new TenantMembers(databases),
  })

  /**
   * Watches the queues of the turns. `asked()` counts the turns asked so far; `untilQueued()`
   * answers a promise that resolves once a change asks for such a turn after that call, holding
   * it or waiting behind the change that holds it.
   */
  const watchQueue = (turn: 'ofIdentity' | 'ofTenants') => {
    const asked = vi.spyOn(MembershipTurns.prototype, turn)

    cleanups.push(async () => asked.mockRestore())

    return {
      asked: () => asked.mock.calls.length,
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
    clock,
    heard,
    mailed: invitations.mailed,
    ann,
    bob,
    cat,
    dan,
    founded,
    invited,
    lastMailed,
    joined,
    rows,
    rolesOf,
    memberRolesIn,
    forgetMember,
    forgetAccount,
    refuseInTenants,
    holdInTenants,
    holdInDirectory,
    onDirectoryQuery,
    letHear,
    admission,
    watchQueue,
    directory,
  }
}

describe('OrganisationInvitations', () => {
  describe('invite', () => {
    it("keeps one pending row for an email without an account and mails it the organisation's name, the role and the row's token, the answer's link carrying that token", async () => {
      const { organisations, ann, dan, founded, mailed, lastMailed, rows } = await harness()

      await founded()

      const view = (
        await organisations.invitations.invite({
          actor: ann.id,
          key: 'acme',
          email: dan.email,
          role: 'admin',
        })
      )._unsafeUnwrap()
      const { token } = lastMailed()

      expect(view.id).toMatch(/^inv_/)
      expect(view).toEqual({ id: view.id, email: dan.email, role: 'admin', link: specLink(token) })
      expect(mailed).toEqual([
        { email: dan.email, organisation: 'Acme', role: 'admin', token, inviter: ann.id },
      ])
      expect(await rows()).toEqual([`acme ${dan.email}`])
      expect((await organisations.invitations.read({ token }))._unsafeUnwrap()).toEqual({
        organisation: { name: 'Acme' },
        role: 'admin',
        forYou: false,
      })
    })

    it('answers an email with an account in the same shape and mails it the same way', async () => {
      const { organisations, ann, bob, dan, founded, mailed, invited } = await harness()

      await founded()

      const without = await invited(dan.email)
      const withAccount = await invited(bob.email)

      expect(Object.keys(withAccount).sort()).toEqual(Object.keys(without).sort())
      expect(withAccount.id).toMatch(/^inv_/)
      expect(mailed.map((mail) => Object.keys(mail).sort())).toEqual([
        ['email', 'inviter', 'organisation', 'role', 'token'],
        ['email', 'inviter', 'organisation', 'role', 'token'],
      ])
      expect(mailed.map((mail) => mail.inviter)).toEqual([ann.id, ann.id])
      expect(
        (await organisations.invitations.pending({ actor: ann.id, key: 'acme' }))
          ._unsafeUnwrap()
          .map((each) => each.email),
      ).toEqual([bob.email, dan.email])
    })

    it("refuses a member's email in any case, writing no row and mailing nothing", async () => {
      const { organisations, ann, bob, founded, joined, mailed, rows } = await harness()

      await founded()
      await joined(bob)

      const mails = mailed.length

      for (const email of [bob.email, 'BOB@Example.TEST']) {
        expect(
          (
            await organisations.invitations.invite({
              actor: ann.id,
              key: 'acme',
              email,
              role: 'member',
            })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('already-member'))
      }

      expect(mailed).toHaveLength(mails)
      expect(await rows()).toEqual([])
    })

    it('refuses a member, a stranger and an organisation that is not there, writing nothing', async () => {
      const { organisations, ann, bob, cat, dan, founded, joined, mailed, rows } = await harness()

      await founded()
      await joined(bob)

      const mails = mailed.length
      const invite = (actor: IdentityId, key: string) =>
        organisations.invitations.invite({ actor, key, email: dan.email, role: 'member' })

      expect((await invite(bob.id, 'acme'))._unsafeUnwrapErr()).toEqual(refused('not-admin'))
      expect((await invite(cat.id, 'acme'))._unsafeUnwrapErr()).toEqual(refused('not-a-member'))
      expect((await invite(ann.id, 'nowhere'))._unsafeUnwrapErr()).toEqual(
        refused('no-such-tenant'),
      )
      expect(mailed).toHaveLength(mails)
      expect(await rows()).toEqual([])
    })

    it("replaces the email's invitation when it is invited again: one row, the new role, the first link dead", async () => {
      const { organisations, ann, dan, founded, invited, lastMailed, rows } = await harness()

      await founded()
      await invited(dan.email, 'member')

      const first = lastMailed().token
      const again = await invited(dan.email, 'admin')
      const second = lastMailed().token

      expect(second).not.toBe(first)
      expect(await rows()).toEqual([`acme ${dan.email}`])
      expect((await organisations.invitations.read({ token: first }))._unsafeUnwrapErr()).toEqual(
        refused('link-invalid'),
      )
      expect(
        (await organisations.invitations.read({ token: second }))._unsafeUnwrap(),
      ).toMatchObject({ role: 'admin' })
      expect(
        (await organisations.invitations.pending({ actor: ann.id, key: 'acme' }))._unsafeUnwrap(),
      ).toEqual([{ id: again.id, email: dan.email, role: 'admin', link: specLink(second) }])
    })
  })

  describe('pending and revoke', () => {
    it("lists the organisation's invitations newest first, each with the link that was mailed", async () => {
      const { organisations, ann, bob, cat, dan, founded, invited, mailed } = await harness()

      await founded()

      const first = await invited(dan.email)
      const second = await invited(bob.email, 'admin')
      const third = await invited(cat.email)
      const link = (index: number) => specLink(mailed[index]?.token ?? '')

      expect(
        (await organisations.invitations.pending({ actor: ann.id, key: 'acme' }))._unsafeUnwrap(),
      ).toEqual([
        { id: third.id, email: cat.email, role: 'member', link: link(2) },
        { id: second.id, email: bob.email, role: 'admin', link: link(1) },
        { id: first.id, email: dan.email, role: 'member', link: link(0) },
      ])
    })

    it("lists an organisation's invitations to its admins only", async () => {
      const { organisations, ann, bob, cat, founded, joined } = await harness()

      await founded()
      await joined(bob)

      const list = (actor: IdentityId, key = 'acme') =>
        organisations.invitations.pending({ actor, key })

      expect((await list(bob.id))._unsafeUnwrapErr()).toEqual(refused('not-admin'))
      expect((await list(cat.id))._unsafeUnwrapErr()).toEqual(refused('not-a-member'))
      expect((await list(ann.id, 'nowhere'))._unsafeUnwrapErr()).toEqual(refused('no-such-tenant'))
    })

    it('revokes an invitation: its link reads as invalid and no account accepts it', async () => {
      const { organisations, ann, bob, founded, invited, lastMailed, rolesOf, rows } =
        await harness()

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()

      expect(
        (
          await organisations.invitations.revoke({
            actor: ann.id,
            key: 'acme',
            invitation: view.id,
          })
        ).isOk(),
      ).toBe(true)
      expect(await rows()).toEqual([])
      expect((await organisations.invitations.read({ token }))._unsafeUnwrapErr()).toEqual(
        refused('link-invalid'),
      )

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.accept({ identity: bob.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
      }

      expect(await rolesOf('acme', bob.id)).toEqual([])
    })

    it("revokes nothing of another organisation's invitation or of one already gone, and answers success", async () => {
      const { organisations, ann, bob, dan, founded, invited, lastMailed, rows } = await harness()

      await founded()
      await founded('beta', 'Beta', bob)

      const elsewhere = (
        await organisations.invitations.invite({
          actor: bob.id,
          key: 'beta',
          email: dan.email,
          role: 'member',
        })
      )._unsafeUnwrap()
      const { token } = lastMailed()
      const own = await invited(dan.email)
      const revoke = (invitation: typeof own.id) =>
        organisations.invitations.revoke({ actor: ann.id, key: 'acme', invitation })

      // Ann is an admin of acme only: her revoke of beta's invitation through acme deletes nothing.
      expect((await revoke(elsewhere.id)).isOk()).toBe(true)
      expect((await organisations.invitations.read({ token }))._unsafeUnwrap()).toMatchObject({
        organisation: { name: 'Beta' },
      })

      // Her own is deleted by the first revoke, and the second finds it gone.
      expect((await revoke(own.id)).isOk()).toBe(true)
      expect((await revoke(own.id)).isOk()).toBe(true)
      expect(await rows()).toEqual([`beta ${dan.email}`])
    })

    it('refuses a revoke to a member of the organisation', async () => {
      const { organisations, bob, dan, founded, invited, joined, rows } = await harness()

      await founded()
      await joined(bob)

      const view = await invited(dan.email)

      expect(
        (
          await organisations.invitations.revoke({
            actor: bob.id,
            key: 'acme',
            invitation: view.id,
          })
        )._unsafeUnwrapErr(),
      ).toEqual(refused('not-admin'))
      expect(await rows()).toEqual([`acme ${dan.email}`])
    })
  })

  describe('read and mine', () => {
    it('tells a guest the organisation and the role, never the email, and the invited account that it is for it', async () => {
      const { organisations, bob, cat, founded, invited, lastMailed } = await harness()

      await founded()
      await invited(bob.email, 'admin')

      const { token } = lastMailed()
      const read = async (caller?: { email: string }) =>
        (await organisations.invitations.read({ token, caller }))._unsafeUnwrap()

      expect(await read()).toEqual({ organisation: { name: 'Acme' }, role: 'admin', forYou: false })
      expect(JSON.stringify(await read())).not.toContain(bob.email)
      expect(await read({ email: bob.email })).toEqual({
        organisation: { name: 'Acme' },
        role: 'admin',
        forYou: true,
      })
      expect((await read({ email: 'BOB@Example.test' })).forYou).toBe(true)
      expect((await read({ email: cat.email })).forYou).toBe(false)
    })

    it('reads a token the gateway did not sign as an invalid link, and a link of a week past as expired, also once its row was swept', async () => {
      const { organisations, clock, ann, bob, dan, founded, invited, lastMailed } = await harness()

      await founded()
      await invited(bob.email)

      const { token } = lastMailed()

      expect(
        (await organisations.invitations.read({ token: 'not-a-token' }))._unsafeUnwrapErr(),
      ).toEqual(refused('link-invalid'))

      await clock.advance(INVITATION_LIFETIME_MS + 1)
      expect((await organisations.invitations.read({ token }))._unsafeUnwrapErr()).toEqual(
        refused('link-expired'),
      )

      // The next invitation of the organisation sweeps the expired row.
      ;(
        await organisations.invitations.invite({
          actor: ann.id,
          key: 'acme',
          email: dan.email,
          role: 'member',
        })
      )._unsafeUnwrap()
      expect((await organisations.invitations.read({ token }))._unsafeUnwrapErr()).toEqual(
        refused('link-expired'),
      )
    })

    it('reads the link of an organisation that is gone as invalid, and no account accepts or declines it', async () => {
      const { organisations, ann, bob, founded, invited, lastMailed } = await harness()

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()

      expect((await organisations.leaveAll(ann.id)).isOk()).toBe(true)
      expect((await organisations.invitations.read({ token }))._unsafeUnwrapErr()).toEqual(
        refused('link-invalid'),
      )

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.accept({ identity: bob.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
        expect(
          (
            await organisations.invitations.decline({ identity: bob.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
      }
    })

    it("lists an account's invitations newest first, those to organisations it belongs to left out", async () => {
      const { organisations, bob, founded, invited } = await harness()

      await founded()
      await founded('beta', 'Beta')
      await founded('gamma', 'Gamma')

      const toAcme = await invited(bob.email, 'member', 'acme')
      const toBeta = await invited(bob.email, 'admin', 'beta')
      const toGamma = await invited(bob.email, 'member', 'gamma')

      expect((await organisations.invitations.mine({ identity: bob.id }))._unsafeUnwrap()).toEqual([
        { id: toGamma.id, organisation: { name: 'Gamma' }, role: 'member' },
        { id: toBeta.id, organisation: { name: 'Beta' }, role: 'admin' },
        { id: toAcme.id, organisation: { name: 'Acme' }, role: 'member' },
      ])
      ;(
        await organisations.invitations.accept({ identity: bob.id, invitation: toBeta.id })
      )._unsafeUnwrap()
      expect(
        (await organisations.invitations.mine({ identity: bob.id }))
          ._unsafeUnwrap()
          .map((each) => each.id),
      ).toEqual([toGamma.id, toAcme.id])
    })

    it('lists nothing for an account that is gone', async () => {
      const { organisations, bob, founded, invited, forgetAccount } = await harness()

      await founded()
      await invited(bob.email)
      await forgetAccount(bob.id)

      expect((await organisations.invitations.mine({ identity: bob.id }))._unsafeUnwrap()).toEqual(
        [],
      )
    })
  })

  describe('accept', () => {
    it.each(['id', 'token'] as const)(
      'makes the invited account a member with the role of the row when it accepts by %s: the member row, the membership, the listeners told, the row spent',
      async (via) => {
        const {
          organisations,
          bob,
          founded,
          invited,
          lastMailed,
          heard,
          rolesOf,
          memberRolesIn,
          rows,
        } = await harness()

        await founded()

        const view = await invited(bob.email, 'admin')
        const invitation = via === 'id' ? view.id : lastMailed().token
        const membership = (
          await organisations.invitations.accept({ identity: bob.id, invitation })
        )._unsafeUnwrap()

        expect(membership).toEqual({
          tenant: { id: membership.tenant.id, key: 'acme', name: 'Acme' },
          role: 'admin',
        })
        expect((await organisations.membershipsOf(bob.id))._unsafeUnwrap()).toEqual([membership])
        expect(await rolesOf('acme', bob.id)).toEqual(['admin'])
        expect((await memberRolesIn('acme'))[bob.id]).toBe('admin')
        expect(heard.at(-1)).toEqual([bob.id, [membership]])
        expect(await rows()).toEqual([])
        expect(
          (await organisations.invitations.mine({ identity: bob.id }))._unsafeUnwrap(),
        ).toEqual([])
      },
    )

    it('refuses another account with other-account, writing nothing, whether the link is named by id or by token', async () => {
      const everything = await harness()
      const { organisations, ann, bob, cat, founded, invited, lastMailed, heard } = everything

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()
      const told = heard.length

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.accept({ identity: cat.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('other-account'))
      }

      expect(await everything.rolesOf('acme', cat.id)).toEqual([])
      expect(await everything.memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
      expect(heard).toHaveLength(told)
    })

    it('refuses an account that is a member already with already-member, keeps the row, and writes the member row again with the role the directory holds', async () => {
      const everything = await harness()
      const { organisations, admission, bob, founded, invited, heard } = everything
      const { tenant } = await founded()
      const view = await invited(bob.email, 'member')

      // Bob becomes an admin behind the invitation's back, and his member row is lost.
      ;(await admission.admit(tenant, bob.id, 'admin'))._unsafeUnwrap()
      await everything.forgetMember('acme', bob.id)

      const told = heard.length

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toEqual(refused('already-member'))
      expect((await everything.memberRolesIn('acme'))[bob.id]).toBe('admin')
      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
      expect(heard).toHaveLength(told)
    })

    it('refuses with already-member a membership that appears between the read and the transaction, keeping the invitation and restoring the member row', async () => {
      const everything = await harness()
      const { organisations, directory, bob, founded, invited, heard } = everything
      const { tenant } = await founded()
      const view = await invited(bob.email, 'member')
      const told = heard.length

      // Another gateway process admits bob as an admin once the accept has read that he is none.
      everything.onDirectoryQuery((text) => {
        if (text === invitationAcceptStatement) {
          everything.onDirectoryQuery(undefined)

          return directory.db
            .query(membershipAddStatement, {
              id: membershipIdFactory.create(),
              identity: recordId('identity', bob.id),
              tenant: recordId('tenant', tenant.id),
              role: 'admin',
            })
            .then(() => undefined)
        }
      })

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toEqual(refused('already-member'))
      expect(await everything.rolesOf('acme', bob.id)).toEqual(['admin'])
      expect((await everything.memberRolesIn('acme'))[bob.id]).toBe('admin')
      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
      expect(heard).toHaveLength(told)
    })

    it('lets the second of two accepts at once from two devices answer invitation-gone, after the first made the one membership', async () => {
      const everything = await harness()
      const { organisations, bob, founded, invited, lastMailed, heard } = everything

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()
      const held = everything.holdInTenants(memberAddStatement)
      const queue = everything.watchQueue('ofIdentity')
      const first = organisations.invitations.accept({ identity: bob.id, invitation: view.id })

      await held.waiting

      const placed = queue.asked()
      const second = organisations.invitations.accept({ identity: bob.id, invitation: token })

      // Both calls are under way before either settles: the second is in bob's queue behind the first.
      expect(queue.asked()).toBe(placed + 1)
      held.release()

      expect((await first).isOk()).toBe(true)
      expect((await second)._unsafeUnwrapErr()).toEqual(refused('invitation-gone'))
      expect(await everything.rolesOf('acme', bob.id)).toEqual(['member'])
      expect(heard.filter(([identity]) => identity === bob.id)).toHaveLength(1)
    })

    it('refuses an accept that waited behind a re-invitation of the email with invitation-gone, and the new link makes the membership', async () => {
      const everything = await harness()
      const { organisations, ann, bob, founded, invited } = everything

      await founded()

      const old = await invited(bob.email, 'member')
      const held = everything.holdInDirectory(invitationReplaceStatement)
      const queue = everything.watchQueue('ofTenants')
      const again = organisations.invitations.invite({
        actor: ann.id,
        key: 'acme',
        email: bob.email,
        role: 'admin',
      })

      await held.waiting

      const queued = queue.untilQueued()
      const accept = organisations.invitations.accept({ identity: bob.id, invitation: old.id })

      // The accept asked for the organisation's turn, behind the re-invitation that holds it.
      await queued
      held.release()

      const fresh = (await again)._unsafeUnwrap()

      expect((await accept)._unsafeUnwrapErr()).toEqual(refused('invitation-gone'))
      expect(await everything.rolesOf('acme', bob.id)).toEqual([])
      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: fresh.id })
        )._unsafeUnwrap(),
      ).toMatchObject({ role: 'admin' })
    })

    it('leaves the link live when the organisation database refuses the member row, and a second ask makes the membership', async () => {
      const everything = await harness()
      const { organisations, bob, founded, invited, heard } = everything

      await founded()

      const view = await invited(bob.email)
      const told = heard.length

      everything.refuseInTenants(memberAddStatement)

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toMatchObject({ code: 'data:WRITE_FAILED' })
      expect(await everything.rolesOf('acme', bob.id)).toEqual([])
      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
      expect(heard).toHaveLength(told)

      everything.refuseInTenants(undefined)

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrap(),
      ).toMatchObject({ role: 'member' })
      expect(await everything.rolesOf('acme', bob.id)).toEqual(['member'])
      expect(await everything.rows()).toEqual([])
    })

    it('leaves the link live when the directory transaction fails after the member row, and a second ask makes the membership', async () => {
      const everything = await harness()
      const { organisations, bob, founded, invited, heard } = everything

      await founded()

      const view = await invited(bob.email)
      const told = heard.length

      everything.onDirectoryQuery((text) => {
        if (text === invitationAcceptStatement) {
          throw new Error('the directory refused the transaction')
        }
      })

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toMatchObject({ code: 'data:WRITE_FAILED' })
      expect(await everything.rolesOf('acme', bob.id)).toEqual([])
      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
      expect((await everything.memberRolesIn('acme'))[bob.id]).toBe('member')
      expect(heard).toHaveLength(told)

      everything.onDirectoryQuery(undefined)

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrap(),
      ).toMatchObject({ role: 'member' })
      expect(await everything.rolesOf('acme', bob.id)).toEqual(['member'])
      expect(await everything.rows()).toEqual([])
    })

    it('answers failed when the telling fails after the commit, with the membership made, its member row right and the link spent', async () => {
      const everything = await harness()
      const { organisations, bob, founded, invited, lastMailed } = everything

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()

      everything.letHear(false)

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toMatchObject({ code: 'data:WRITE_FAILED' })
      expect(await everything.rolesOf('acme', bob.id)).toEqual(['member'])
      expect((await everything.memberRolesIn('acme'))[bob.id]).toBe('member')
      expect(await everything.rows()).toEqual([])
      expect((await organisations.invitations.read({ token }))._unsafeUnwrapErr()).toEqual(
        refused('link-invalid'),
      )

      everything.letHear(true)

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.accept({ identity: bob.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
      }
    })

    it('answers invitation-gone to the old link once an admin removed the member: a spent link never readmits', async () => {
      const everything = await harness()
      const { organisations, ann, bob, founded, invited, lastMailed } = everything

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()

      ;(
        await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
      )._unsafeUnwrap()
      ;(
        await organisations.remove({ actor: ann.id, key: 'acme', identity: bob.id })
      )._unsafeUnwrap()

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.accept({ identity: bob.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
      }

      expect(await everything.rolesOf('acme', bob.id)).toEqual([])
      expect(await everything.memberRolesIn('acme')).toEqual({ [ann.id]: 'admin' })
    })

    it('answers invitation-gone to a link a week past, and makes no membership', async () => {
      const everything = await harness()
      const { organisations, clock, bob, founded, invited, lastMailed } = everything

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()

      await clock.advance(INVITATION_LIFETIME_MS + 1)

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.accept({ identity: bob.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
      }

      expect(await everything.rolesOf('acme', bob.id)).toEqual([])
    })

    it('refuses an account that is gone with no-such-identity, and makes no membership', async () => {
      const everything = await harness()
      const { organisations, bob, founded, invited } = everything

      await founded()

      const view = await invited(bob.email)

      await everything.forgetAccount(bob.id)

      expect(
        (
          await organisations.invitations.accept({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toEqual(refused('no-such-identity'))
      expect(await everything.rolesOf('acme', bob.id)).toEqual([])
    })
  })

  describe('decline', () => {
    it.each(['id', 'token'] as const)(
      'spends the invitation when its account declines by %s: the row gone, the link invalid, no membership, nobody told',
      async (via) => {
        const everything = await harness()
        const { organisations, bob, founded, invited, lastMailed, heard } = everything

        await founded()

        const view = await invited(bob.email)
        const { token } = lastMailed()
        const told = heard.length

        expect(
          (
            await organisations.invitations.decline({
              identity: bob.id,
              invitation: via === 'id' ? view.id : token,
            })
          ).isOk(),
        ).toBe(true)
        expect(await everything.rows()).toEqual([])
        expect((await organisations.invitations.read({ token }))._unsafeUnwrapErr()).toEqual(
          refused('link-invalid'),
        )
        expect(await everything.rolesOf('acme', bob.id)).toEqual([])
        expect(heard).toHaveLength(told)
        expect(
          (
            await organisations.invitations.decline({ identity: bob.id, invitation: view.id })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('invitation-gone'))
      },
    )

    it('refuses another account with other-account, keeping the row', async () => {
      const everything = await harness()
      const { organisations, bob, cat, founded, invited, lastMailed } = everything

      await founded()

      const view = await invited(bob.email)
      const { token } = lastMailed()

      for (const invitation of [view.id, token]) {
        expect(
          (
            await organisations.invitations.decline({ identity: cat.id, invitation })
          )._unsafeUnwrapErr(),
        ).toEqual(refused('other-account'))
      }

      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
    })

    it('refuses an account that is gone with no-such-identity, keeping the row', async () => {
      const everything = await harness()
      const { organisations, bob, founded, invited } = everything

      await founded()

      const view = await invited(bob.email)

      await everything.forgetAccount(bob.id)

      expect(
        (
          await organisations.invitations.decline({ identity: bob.id, invitation: view.id })
        )._unsafeUnwrapErr(),
      ).toEqual(refused('no-such-identity'))
      expect(await everything.rows()).toEqual([`acme ${bob.email}`])
    })
  })
})
