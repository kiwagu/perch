import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, invitationIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { OrganisationService } from '../features/organisation/application/organisation.service'
import type { InvitationsPort, ReceivedInvitation } from '../platform/invitations.port'

import { openTestWorld, type TestWorld } from './__fixtures__/session'
import { signedIn, signedInElsewhere } from './__fixtures__/signed-in'
import { createInvitations } from './invitations'
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

/** Bob as another tab of the browser keeps him once it signed him in. */
const bob: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  token: 'token-bob',
  memberships: [],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'admin',
}

const received: ReceivedInvitation = {
  id: invitationIdFactory.create(),
  organisation: { name: 'Acme' },
  role: 'member',
}

/** The gateway's invitation routes as they answer Ann, invited to Acme. */
function answering() {
  const calls: Array<readonly unknown[]> = []
  const api: InvitationsPort = {
    read: (token) => {
      calls.push(['read', token])

      return okAsync({ organisation: { name: 'Acme' }, role: 'member', forYou: true })
    },
    mine: () => {
      calls.push(['mine'])

      return okAsync([received])
    },
    accept: (invitation) => {
      calls.push(['accept', invitation])

      return okAsync(acme)
    },
    decline: (invitation) => {
      calls.push(['decline', invitation])

      return okAsync(undefined)
    },
  }

  return { api, calls }
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

describe('createInvitations', () => {
  it('accept saves the membership into the session as a creation does, its database open when it answers', async () => {
    const { session, storage, tenantsOpened, annSession } = await annSignedIn()
    const { api, calls } = answering()
    const invitations = createInvitations(api, session)

    expect((await invitations.accept(received.id))._unsafeUnwrap()).toEqual(acme)
    expect(calls).toEqual([['accept', received.id]])
    expect(session.memberships()).toEqual([acme])
    expect(savedMemberships(storage, annSession)).toEqual([acme])
    expect(session.space()?.tenants()).toEqual(['acme'])
    expect(tenantsOpened()).toEqual(['acme'])
  })

  it('accept adds the membership to the newest list any tab kept, not to an older one the space still shows', async () => {
    const { session, storage, annSession } = await annSignedIn()

    saveMemberships(storage, annSession, [globex])

    const invitations = createInvitations(answering().api, session)

    expect((await invitations.accept(received.id)).isOk()).toBe(true)
    expect(savedMemberships(storage, annSession)).toEqual([globex, acme])
  })

  it('accept takes in a change of memberships another tab kept while the gateway answered', async () => {
    const { session, storage, annSession } = await annSignedIn()
    let answer = (): void => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const api: InvitationsPort = {
      ...answering().api,
      accept: () => ResultAsync.fromSafePromise(answered).map(() => acme),
    }
    const accepting = createInvitations(api, session).accept(received.id)

    storage.changeElsewhere(
      membershipsKeyOf(annSession.signIn),
      JSON.stringify({ identity: ann.identity.id, memberships: [globex] }),
    )
    answer()

    expect((await accepting).isOk()).toBe(true)
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

  it('accept adopts nothing into a space that replaced the asking one while the gateway answered', async () => {
    const { session, storage, tenantsOpened } = await annSignedIn()
    let answer = (): void => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const api: InvitationsPort = {
      ...answering().api,
      accept: () => ResultAsync.fromSafePromise(answered).map(() => acme),
    }
    const accepting = createInvitations(api, session).accept(received.id)

    // Meanwhile another tab signed Bob in: this tab's space is his now.
    const bobSession = signedInElsewhere(storage, bob)

    await vi.waitFor(() => expect(session.space()?.identity.id).toBe(bob.identity.id))
    answer()

    expect((await accepting)._unsafeUnwrap()).toEqual(acme)
    expect(savedMemberships(storage, bobSession)).toEqual([])
    expect(session.memberships()).toEqual([])
    expect(session.space()?.tenants()).toEqual([])
    expect(tenantsOpened()).toEqual([])
  })

  it('a refused accept adopts nothing and answers the refusal as it came', async () => {
    const { session, storage, annSession } = await annSignedIn()
    const refusing: InvitationsPort = {
      ...answering().api,
      accept: () => errAsync(dataError('data:WRITE_REJECTED', 'invitation-gone')),
    }
    const refused = await createInvitations(refusing, session).accept(received.id)

    expect(refused._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'invitation-gone',
    })
    expect(session.memberships()).toEqual([])
    expect(savedMemberships(storage, annSession)).toEqual([])
  })

  it("reads, lists and declines as the gateway did, leaving the session's memberships alone", async () => {
    const { session } = await annSignedIn()
    const { api, calls } = answering()
    const invitations = createInvitations(api, session)

    expect((await invitations.read('link-token'))._unsafeUnwrap()).toEqual({
      organisation: { name: 'Acme' },
      role: 'member',
      forYou: true,
    })
    expect((await invitations.mine())._unsafeUnwrap()).toEqual([received])
    expect((await invitations.decline(received.id)).isOk()).toBe(true)
    expect(calls).toEqual([['read', 'link-token'], ['mine'], ['decline', received.id]])
    expect(session.memberships()).toEqual([])
    expect(session.space()?.tenants()).toEqual([])
  })

  it('the service selects the accepted organisation once its adoption settled: its database is open, and it is the current one', async () => {
    const { session, storage, tenantsOpened, annSession } = await annSignedIn()

    saveMemberships(storage, annSession, [globex])

    const service = new OrganisationService(
      session,
      {
        create: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        members: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        invite: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        invitations: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        revokeInvitation: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        setRole: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
        remove: () => errAsync(dataError('data:OFFLINE', 'not in this test')),
      },
      createInvitations(answering().api, session),
      replicaSchema,
    )

    expect((await service.accept(received.id))._unsafeUnwrap()).toEqual(acme)
    expect(tenantsOpened()).toContain('acme')
    expect(service.current()).toEqual(acme)
  })
})
