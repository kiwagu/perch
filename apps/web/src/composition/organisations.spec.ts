import { okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { MemberView } from '../platform/organisations.port'

import { openTestWorld, type TestWorld } from './__fixtures__/session'
import { createOrganisations } from './organisations'
import type { OrganisationsApi } from './organisations-api'
import {
  MEMBERSHIPS_KEY,
  memoryStorage,
  saveDevice,
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

/** The gateway's organisation routes as they answer Ann, who creates Acme and invites Bob. */
function answering() {
  const created: Array<{ key: string; name: string }> = []
  const api: OrganisationsApi = {
    list: () => okAsync([acme]),
    create: (input) => {
      created.push(input)

      return okAsync(acme)
    },
    members: () => okAsync([bob]),
    invite: () => okAsync(bob),
    remove: () => okAsync(undefined),
  }

  return { api, created }
}

let opened: TestWorld | undefined

afterEach(async () => {
  await opened?.close()
  expect(opened?.failures).toEqual([])
  opened = undefined
})

/** Ann signed in on a device that is not online, a member of no organisation yet. */
async function annSignedIn(): Promise<TestWorld> {
  const storage = memoryStorage()

  saveDevice(storage, ann)
  opened = await openTestWorld({ storage, online: false })
  expect((await opened.session.restore()).isOk()).toBe(true)

  return opened
}

describe('createOrganisations', () => {
  it('create saves the membership into the session and makes it current when it is the only one', async () => {
    const { session, storage, tenantsOpened } = await annSignedIn()
    const { api, created } = answering()
    const organisations = createOrganisations(api, session)

    expect((await organisations.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrap()).toEqual(
      acme,
    )
    expect(created).toEqual([{ key: 'acme', name: 'Acme' }])
    expect(session.memberships()).toEqual([acme])
    expect(session.currentTenant()).toEqual(acme)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
    expect(session.space()?.tenants()).toEqual(['acme'])
    expect(tenantsOpened()).toEqual(['acme'])
  })

  it('create adds the membership to the newest list any tab kept, not to an older one the space still shows', async () => {
    const { session, storage } = await annSignedIn()

    // Another tab kept a newer list, which this tab's space has not followed yet.
    saveMemberships(storage, ann.identity.id, [globex])

    const organisations = createOrganisations(answering().api, session)

    expect((await organisations.create({ key: 'acme', name: 'Acme' })).isOk()).toBe(true)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([globex, acme])
    expect(
      session
        .memberships()
        .map(({ tenant }) => tenant.key)
        .sort(),
    ).toEqual(['acme', 'globex'])
  })

  it('create takes in a change of memberships another tab kept while the gateway answered', async () => {
    const { session, storage } = await annSignedIn()
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
      MEMBERSHIPS_KEY,
      JSON.stringify({ identity: ann.identity.id, memberships: [globex] }),
    )
    answer()

    expect((await creating).isOk()).toBe(true)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([globex, acme])
    await vi.waitFor(() =>
      expect(
        session
          .memberships()
          .map(({ tenant }) => tenant.key)
          .sort(),
      ).toEqual(['acme', 'globex']),
    )
  })

  it("answers members, invites and removals as the gateway did, leaving the session's memberships alone", async () => {
    const { session } = await annSignedIn()
    const organisations = createOrganisations(answering().api, session)

    expect((await organisations.members('acme'))._unsafeUnwrap()).toEqual([bob])
    expect((await organisations.invite('acme', bob.identity.email))._unsafeUnwrap()).toEqual(bob)
    expect((await organisations.remove('acme', bob.identity.id)).isOk()).toBe(true)
    expect(session.memberships()).toEqual([])
    expect(session.space()?.tenants()).toEqual([])
  })
})
