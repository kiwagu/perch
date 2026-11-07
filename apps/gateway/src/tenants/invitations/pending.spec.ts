import { afterEach, describe, expect, it } from 'vitest'

import { type LocalDb, recordId, tenantDatabase } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import {
  type IdentityId,
  identityIdFactory,
  invitationIdFactory,
  membershipIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import identityRow from '../../auth/__fixtures__/identity-row.surql'
import { DIRECTORY, NAMESPACE } from '../../config'
import invitationRows from '../__fixtures__/invitation-rows.surql'
import type { Tenant } from '../organisation-rows'
import membershipAddStatement from '../surql/membership-add.surql'
import tenantCreateStatement from '../surql/tenant-create.surql'
import tenantReadyStatement from '../surql/tenant-ready.surql'

import { INVITATION_LIFETIME_MS, type PendingInvitation, PendingInvitations } from './pending'
import { invitationKey, signInvitationToken } from './token'

const SECRET = 'test-secret-0123456789-0123456789-0123456789'
const START = Date.UTC(2026, 10, 7)
const HOUR_MS = 60 * 60 * 1000

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

/** The directory with every query answering `answer`, as a driver that answers an unexpected shape. */
function answering(local: LocalDb, answer: unknown): LocalDb {
  const query = () =>
    Object.assign(Promise.resolve(answer), { retry: () => Promise.resolve(answer) })
  const db = new Proxy(local.db, {
    get(target, property) {
      if (property === 'query') {
        return query
      }

      const value: unknown = Reflect.get(target, property)

      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })

  return { ...local, db }
}

/** Invitations over an embedded directory, with three identities and a manual clock. */
async function harness() {
  const directory = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()

  closers.push(() => directory.close())

  const clock = manualClock(START)
  const invitations = new PendingInvitations({ directory, secret: SECRET, clock })

  const identity = async (email: string): Promise<IdentityId> => {
    const key = identityIdFactory.create()

    await directory.db.query(identityRow, { key, email })

    return key
  }
  const ann = await identity('ann@example.test')
  const bob = await identity('bob@example.test')

  /** An organisation created by `creator` as its admin, ready unless `ready` says it is not. */
  const organisation = async (key: string, creator: IdentityId, ready = true): Promise<Tenant> => {
    const id = tenantIdFactory.create()

    await directory.db.query(tenantCreateStatement, {
      id,
      key,
      name: `Org ${key}`,
      database: tenantDatabase(key),
      identity: recordId('identity', creator),
      membership: membershipIdFactory.create(),
    })

    if (ready) {
      await directory.db.query(tenantReadyStatement, { id })
    }

    return { id, key, name: `Org ${key}` }
  }

  const acme = await organisation('acme', ann)

  /** The keys of the organisations and the emails of the invitations the directory holds. */
  const rows = async () => {
    const [found] =
      await directory.db.query<[Array<{ key: string; email: string }>]>(invitationRows)

    return found.map((row) => `${row.key} ${row.email}`)
  }

  /** `ann` invites `email` to `tenant` (acme unless named) with `role`. */
  const invite = async (email: string, role: 'member' | 'admin' = 'member', tenant = acme) =>
    (await invitations.replace({ tenant, email, role, inviter: ann }))._unsafeUnwrap()

  return { directory, clock, invitations, ann, bob, acme, organisation, identity, rows, invite }
}

/** What a pending invitation to `tenant` is as the store answers it. */
const pending = (
  invitation: PendingInvitation,
  tenant: Tenant,
  email: string,
  role: string,
  ready = true,
) => ({
  id: invitation.id,
  tenant: { ...tenant, ready },
  email,
  role,
  token: invitation.token,
  expiresAt: invitation.expiresAt,
})

describe('PendingInvitations', () => {
  it('keeps an invitation for seven days from the gateway clock and reads its token back', async () => {
    const { invitations, clock, acme, invite } = await harness()
    const invitation = await invite('carol@example.test', 'admin')

    expect(invitation.id).toMatch(/^inv_/)
    expect(invitation).toEqual({
      id: invitation.id,
      tenant: { ...acme, ready: true },
      email: 'carol@example.test',
      role: 'admin',
      token: invitation.token,
      expiresAt: START + INVITATION_LIFETIME_MS,
    })
    expect(INVITATION_LIFETIME_MS).toBe(7 * 24 * HOUR_MS)
    expect((await invitations.read(invitation.token))._unsafeUnwrap()).toEqual({
      kind: 'invitation',
      invitation,
    })
    expect((await invitations.byId(invitation.id))._unsafeUnwrap()).toEqual(invitation)

    await clock.advance(INVITATION_LIFETIME_MS - 1)
    expect((await invitations.read(invitation.token))._unsafeUnwrap().kind).toBe('invitation')
    expect((await invitations.byId(invitation.id))._unsafeUnwrap()).toEqual(invitation)

    await clock.advance(1)
    expect((await invitations.read(invitation.token))._unsafeUnwrap()).toEqual({ kind: 'expired' })
    expect((await invitations.byId(invitation.id))._unsafeUnwrap()).toBeUndefined()
  })

  it('keeps one row for an email and an organisation: the second invitation replaces the first, whose link then reads invalid', async () => {
    const { invitations, acme, invite, rows } = await harness()
    const first = await invite('carol@example.test', 'member')
    const second = await invite('carol@example.test', 'admin')

    expect(second.id).not.toBe(first.id)
    expect(second.token).not.toBe(first.token)
    expect(await rows()).toEqual(['acme carol@example.test'])
    expect((await invitations.read(first.token))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
    expect((await invitations.byId(first.id))._unsafeUnwrap()).toBeUndefined()
    expect((await invitations.read(second.token))._unsafeUnwrap()).toEqual({
      kind: 'invitation',
      invitation: pending(second, acme, 'carol@example.test', 'admin'),
    })
  })

  it('keeps an email in lower case, and an invitation in upper case replaces the one in lower case', async () => {
    const { invitations, invite, rows } = await harness()
    const first = await invite('carol@example.test')
    const second = await invite('CAROL@Example.TEST', 'admin')

    expect(second.email).toBe('carol@example.test')
    expect(await rows()).toEqual(['acme carol@example.test'])
    expect((await invitations.read(first.token))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
  })

  it("keeps an email's invitations to two organisations apart", async () => {
    const { invitations, ann, invite, organisation, rows } = await harness()
    const orbit = await organisation('orbit', ann)
    const inAcme = await invite('carol@example.test')
    const inOrbit = await invite('carol@example.test', 'admin', orbit)

    expect(await rows()).toEqual(['acme carol@example.test', 'orbit carol@example.test'])
    expect((await invitations.read(inAcme.token))._unsafeUnwrap().kind).toBe('invitation')
    expect((await invitations.read(inOrbit.token))._unsafeUnwrap().kind).toBe('invitation')
  })

  it("sweeps the organisation's expired rows with its next invitation, and no other organisation's", async () => {
    const { invitations, ann, clock, invite, organisation, rows } = await harness()
    const orbit = await organisation('orbit', ann)
    const swept = await invite('carol@example.test')

    await invite('carol@example.test', 'member', orbit)
    await clock.advance(INVITATION_LIFETIME_MS - HOUR_MS)
    await invite('dave@example.test')
    await clock.advance(2 * HOUR_MS)

    // Carol's invitation to acme expired; dave's, one hour younger, has not.
    expect(await rows()).toEqual([
      'acme carol@example.test',
      'acme dave@example.test',
      'orbit carol@example.test',
    ])

    await invite('erin@example.test')

    expect(await rows()).toEqual([
      'acme dave@example.test',
      'acme erin@example.test',
      'orbit carol@example.test',
    ])
    // Its row is gone, and its link says it expired, not that it names nothing.
    expect((await invitations.read(swept.token))._unsafeUnwrap()).toEqual({ kind: 'expired' })
  })

  it('reads a token that is not a link, or one signed for an invitation nobody holds, as invalid', async () => {
    const { invitations } = await harness()
    const nobody = await signInvitationToken(
      { purpose: 'invitation', invitation: invitationIdFactory.create(), at: START },
      invitationKey(SECRET),
    )

    expect((await invitations.read('not-a-token'))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
    expect((await invitations.read(nobody))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
  })

  it("reads the token of an invitation to an organisation that is not ready as invalid, though byId says it isn't ready", async () => {
    const { invitations, ann, organisation, invite } = await harness()
    const draft = await organisation('draft', ann, false)
    const invitation = await invite('carol@example.test', 'member', draft)

    expect((await invitations.read(invitation.token))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
    expect((await invitations.byId(invitation.id))._unsafeUnwrap()).toEqual({
      ...invitation,
      tenant: { ...draft, ready: false },
    })
  })

  it('removes an invitation once: true while it was there, then false, and its link reads invalid', async () => {
    const { invitations, invite, rows } = await harness()
    const invitation = await invite('carol@example.test')

    expect((await invitations.remove(invitation.id))._unsafeUnwrap()).toBe(true)
    expect((await invitations.remove(invitation.id))._unsafeUnwrap()).toBe(false)
    expect(await rows()).toEqual([])
    expect((await invitations.read(invitation.token))._unsafeUnwrap()).toEqual({ kind: 'invalid' })
    expect((await invitations.byId(invitation.id))._unsafeUnwrap()).toBeUndefined()
  })

  it("lists an organisation's live invitations newest first, those past their week not among them, those of a member's email among them", async () => {
    const { directory, invitations, acme, bob, clock, organisation, ann, invite } = await harness()
    const orbit = await organisation('orbit', ann)

    await invite('carol@example.test')
    await clock.advance(INVITATION_LIFETIME_MS - HOUR_MS)

    const dave = await invite('dave@example.test', 'admin')
    const bobs = await invite('bob@example.test')

    await invite('carol@example.test', 'member', orbit)
    await clock.advance(2 * HOUR_MS)
    await directory.db.query(membershipAddStatement, {
      id: membershipIdFactory.create(),
      identity: recordId('identity', bob),
      tenant: recordId('tenant', acme.id),
      role: 'member',
    })

    // Bob belongs to acme now, and still shows: the admin may revoke what it sent.
    expect((await invitations.ofTenant(acme))._unsafeUnwrap()).toEqual([
      pending(bobs, acme, 'bob@example.test', 'member'),
      pending(dave, acme, 'dave@example.test', 'admin'),
    ])
  })

  it('lists no invitation of an organisation that has none', async () => {
    const { invitations, acme } = await harness()

    expect((await invitations.ofTenant(acme))._unsafeUnwrap()).toEqual([])
  })

  it('lists what an email is invited to, newest first, but not an organisation its account belongs to, one not ready, nor an invitation past its week', async () => {
    const { invitations, ann, bob, clock, organisation, invite } = await harness()
    const lime = await organisation('lime', ann)
    const bobs = await organisation('bobs', bob)
    const draft = await organisation('draft', ann, false)
    const old = await organisation('old', ann)

    await invite('bob@example.test', 'member', old)
    await clock.advance(INVITATION_LIFETIME_MS)

    const inAcme = await invite('bob@example.test', 'admin')
    const inLime = await invite('Bob@Example.test', 'member', lime)

    await invite('bob@example.test', 'member', bobs)
    await invite('bob@example.test', 'member', draft)
    await invite('carol@example.test', 'member', lime)

    expect((await invitations.forEmail(bob, 'Bob@example.test'))._unsafeUnwrap()).toEqual([
      { id: inLime.id, organisation: { name: 'Org lime' }, role: 'member' },
      { id: inAcme.id, organisation: { name: 'Org acme' }, role: 'admin' },
    ])
    expect((await invitations.forEmail(ann, 'ann@example.test'))._unsafeUnwrap()).toEqual([])
  })

  it('answers an error, never a missing row or an empty list, for an answer of the directory of an unknown shape', async () => {
    const { directory, acme, bob, invite } = await harness()
    const invitation = await invite('carol@example.test')
    const unknown = { code: 'data:QUERY_FAILED' }
    const over = (answer: unknown) =>
      new PendingInvitations({
        directory: answering(directory, answer),
        secret: SECRET,
        clock: manualClock(START),
      })

    expect((await over([{ nonsense: 1 }]).byId(invitation.id))._unsafeUnwrapErr()).toMatchObject(
      unknown,
    )
    expect((await over([{ nonsense: 1 }]).read(invitation.token))._unsafeUnwrapErr()).toMatchObject(
      unknown,
    )
    expect((await over([[{ nonsense: 1 }]]).ofTenant(acme))._unsafeUnwrapErr()).toMatchObject(
      unknown,
    )
    expect(
      (await over([[{ nonsense: 1 }]]).forEmail(bob, 'bob@example.test'))._unsafeUnwrapErr(),
    ).toMatchObject(unknown)
    expect((await over(['nonsense']).remove(invitation.id))._unsafeUnwrapErr()).toMatchObject(
      unknown,
    )
  })
})
