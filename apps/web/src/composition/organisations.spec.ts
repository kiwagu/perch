import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { identityIdFactory, invitationIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { InvitationView, MemberView } from '../platform/organisations.port'

import { openTestWorld, type TestWorld } from './__fixtures__/session'
import { signedIn, signedInElsewhere } from './__fixtures__/signed-in'
import { createOrganisations } from './organisations'
import type { OrganisationsApi } from './organisations-api'
import {
  type KeptDevice,
  type KeptSession,
  membershipsKeyOf,
  memoryStorage,
  savedMemberships,
  saveMemberships,
} from './storage'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

const bob: MemberView = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  role: 'member',
}

/** Bob as another tab of the browser keeps him once it signed him in. */
const bobsDevice: KeptDevice = { identity: bob.identity, token: 'token-bob', memberships: [] }

const invitationToBob: InvitationView = {
  id: invitationIdFactory.create(),
  email: 'bob@example.test',
  role: 'member',
  link: 'https://perch.example.test/invitation?token=bob',
}

/** The gateway's organisation routes as they answer Ann, who creates Acme and invites Bob. */
function answering() {
  const created: Array<{ key: string; name: string }> = []
  const calls: Array<readonly unknown[]> = []
  const api: OrganisationsApi = {
    list: () => okAsync([acme]),
    create: (input) => {
      created.push(input)

      return okAsync(acme)
    },
    members: () => okAsync([bob]),
    invite: (...input) => {
      calls.push(['invite', ...input])

      return okAsync(invitationToBob)
    },
    invitations: (key) => {
      calls.push(['invitations', key])

      return okAsync([invitationToBob])
    },
    revokeInvitation: (...input) => {
      calls.push(['revokeInvitation', ...input])

      return okAsync(undefined)
    },
    setRole: (...input) => {
      calls.push(['setRole', ...input])

      return okAsync(undefined)
    },
    remove: () => okAsync(undefined),
  }

  return { api, created, calls }
}

let opened: TestWorld | undefined

afterEach(async () => {
  await opened?.close()
  expect(opened?.failures).toEqual([])
  opened = undefined
})

/**
 * Ann signed in on a device that is not online, a member of no organisation yet; `annSession` is
 * her sign-in.
 */
async function annSignedIn(): Promise<TestWorld & { readonly annSession: KeptSession }> {
  const storage = memoryStorage()
  const annSession = signedIn(storage, ann)

  opened = await openTestWorld({ storage, online: false })
  expect((await opened.session.restore()).isOk()).toBe(true)

  return { ...opened, annSession }
}

describe('createOrganisations', () => {
  it('create saves the membership into the session and makes it current when it is the only one', async () => {
    const { session, storage, tenantsOpened, annSession } = await annSignedIn()
    const { api, created } = answering()
    const organisations = createOrganisations(api, session)

    expect((await organisations.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrap()).toEqual(
      acme,
    )
    expect(created).toEqual([{ key: 'acme', name: 'Acme' }])
    expect(session.memberships()).toEqual([acme])
    expect(session.currentTenant()).toEqual(acme)
    expect(savedMemberships(storage, annSession)).toEqual([acme])
    expect(session.space()?.tenants()).toEqual(['acme'])
    expect(tenantsOpened()).toEqual(['acme'])
  })

  it('create adds the membership to the newest list any tab kept, not to an older one the space still shows', async () => {
    const { session, storage, annSession } = await annSignedIn()

    // Another tab kept a newer list, which this tab's space has not followed yet.
    saveMemberships(storage, annSession, [globex])

    const organisations = createOrganisations(answering().api, session)

    expect((await organisations.create({ key: 'acme', name: 'Acme' })).isOk()).toBe(true)
    expect(savedMemberships(storage, annSession)).toEqual([globex, acme])
    expect(
      session
        .memberships()
        .map(({ tenant }) => tenant.key)
        .sort(),
    ).toEqual(['acme', 'globex'])
  })

  it('create takes in a change of memberships another tab kept while the gateway answered', async () => {
    const { session, storage, annSession } = await annSignedIn()
    let answer = (): void => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const api: OrganisationsApi = {
      ...answering().api,
      create: () => ResultAsync.fromSafePromise(answered).map(() => acme),
    }
    const organisations = createOrganisations(api, session)
    const creating = organisations.create({ key: 'acme', name: 'Acme' })

    // Meanwhile another tab keeps the identity's memberships: it joined Globex.
    storage.changeElsewhere(
      membershipsKeyOf(annSession.signIn),
      JSON.stringify({ identity: ann.identity.id, memberships: [globex] }),
    )
    answer()

    expect((await creating).isOk()).toBe(true)
    expect(savedMemberships(storage, annSession)).toEqual([globex, acme])
    await vi.waitFor(() =>
      expect(
        session
          .memberships()
          .map(({ tenant }) => tenant.key)
          .sort(),
      ).toEqual(['acme', 'globex']),
    )
  })

  it('create adopts nothing into a space that replaced the asking one while the gateway answered', async () => {
    const { session, storage, tenantsOpened } = await annSignedIn()
    let answer = (): void => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const api: OrganisationsApi = {
      ...answering().api,
      create: () => ResultAsync.fromSafePromise(answered).map(() => acme),
    }
    const creating = createOrganisations(api, session).create({ key: 'acme', name: 'Acme' })

    // Meanwhile another tab signed Bob in: this tab's space is his now.
    const bobSession = signedInElsewhere(storage, bobsDevice)

    await vi.waitFor(() => expect(session.space()?.identity.id).toBe(bob.identity.id))
    answer()

    expect((await creating)._unsafeUnwrap()).toEqual(acme)
    expect(savedMemberships(storage, bobSession)).toEqual([])
    expect(session.memberships()).toEqual([])
    expect(session.space()?.tenants()).toEqual([])
    expect(tenantsOpened()).toEqual([])
  })

  it("answers members, invitations and removals as the gateway did, leaving the session's memberships alone", async () => {
    const { session } = await annSignedIn()
    const { api, calls } = answering()
    const organisations = createOrganisations(api, session)

    expect((await organisations.members('acme'))._unsafeUnwrap()).toEqual([bob])
    expect(
      (await organisations.invite('acme', bob.identity.email, 'admin'))._unsafeUnwrap(),
    ).toEqual(invitationToBob)
    expect((await organisations.invitations('acme'))._unsafeUnwrap()).toEqual([invitationToBob])
    expect((await organisations.revokeInvitation('acme', invitationToBob.id)).isOk()).toBe(true)
    expect((await organisations.remove('acme', bob.identity.id)).isOk()).toBe(true)
    expect(calls).toEqual([
      ['invite', 'acme', bob.identity.email, 'admin'],
      ['invitations', 'acme'],
      ['revokeInvitation', 'acme', invitationToBob.id],
    ])
    expect(session.memberships()).toEqual([])
    expect(session.space()?.tenants()).toEqual([])
  })

  it('setRole asks the gateway and adopts nothing: the new role reaches every device over the sync channel', async () => {
    const { session, storage, tenantsOpened, annSession } = await annSignedIn()
    const { api, calls } = answering()
    const organisations = createOrganisations(api, session)

    expect((await organisations.create({ key: 'acme', name: 'Acme' })).isOk()).toBe(true)

    const before = savedMemberships(storage, annSession)
    const opened = tenantsOpened()

    expect((await organisations.setRole('acme', bob.identity.id, 'admin')).isOk()).toBe(true)
    expect(calls).toEqual([['setRole', 'acme', bob.identity.id, 'admin']])
    expect(session.memberships()).toEqual([acme])
    expect(savedMemberships(storage, annSession)).toEqual(before)
    expect(tenantsOpened()).toEqual(opened)
  })

  it('setRole passes a refusal of the gateway on and still adopts nothing', async () => {
    const { session, storage, annSession } = await annSignedIn()
    const refusing: OrganisationsApi = {
      ...answering().api,
      setRole: () => errAsync(dataError('data:WRITE_REJECTED', 'last-admin')),
    }
    const organisations = createOrganisations(refusing, session)

    expect(
      (await organisations.setRole('acme', bob.identity.id, 'member'))._unsafeUnwrapErr(),
    ).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'last-admin',
    })
    expect(session.memberships()).toEqual([])
    expect(savedMemberships(storage, annSession)).toEqual([])
  })
})
