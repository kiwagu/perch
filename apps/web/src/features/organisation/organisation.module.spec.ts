import { errAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dataError, SHAPE_RUNNER } from '@workspace/data'
import { Container } from '@workspace/di'
import { tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { type FakeGatewayAuth, fakeGatewayAuth } from '../../composition/__fixtures__/gateway-auth'
import {
  openTestWorld,
  signUpVerified,
  type TestWorld,
} from '../../composition/__fixtures__/session'
import { COMMANDS } from '../../platform/commands.port'
import { INVITATIONS, type InvitationsPort } from '../../platform/invitations.port'
import { ORGANISATIONS, type OrganisationsPort } from '../../platform/organisations.port'
import { SESSION } from '../../platform/session.port'

import { NOTES_SERVICE } from './application/notes.service'
import { ORGANISATION_SERVICE } from './application/organisation.service'
import { OrganisationModule } from './organisation.module'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const offline = () => errAsync(dataError('data:OFFLINE', 'the gateway is out of reach'))

/** The gateway's organisation routes out of reach: these tests go through the session alone. */
const unreachable: OrganisationsPort = {
  create: offline,
  members: offline,
  invite: offline,
  invitations: offline,
  revokeInvitation: offline,
  setRole: offline,
  remove: offline,
}

const noInvitations: InvitationsPort = {
  read: offline,
  mine: offline,
  accept: offline,
  decline: offline,
}

let world: TestWorld
let auth: FakeGatewayAuth
let container: Container

beforeEach(async () => {
  auth = fakeGatewayAuth()
  world = await openTestWorld({ memberships: [acme], auth })

  const root = new Container()
    .singleton(SHAPE_RUNNER, () => world.session.runner)
    .singleton(COMMANDS, () => world.commands)
    .singleton(SESSION, () => world.session)
    .singleton(ORGANISATIONS, () => unreachable)
    .singleton(INVITATIONS, () => noInvitations)

  container = root.child()

  for (const provider of OrganisationModule.providers) {
    container.singleton(provider.provide, provider.useFactory)
  }
})

afterEach(async () => {
  await world.close()

  expect(world.failures).toEqual([])
})

describe('OrganisationModule', () => {
  it("writes and reads the current organisation's notes over the application ports", async () => {
    const ann = (
      await signUpVerified(world.session, auth, {
        email: 'ann@example.test',
        password: 'Secret-ann1',
        name: 'Ann',
        locale: 'en',
      })
    )._unsafeUnwrap()

    expect(container.get(ORGANISATION_SERVICE).current()).toEqual(acme)
    expect(
      (await container.get(NOTES_SERVICE).add({ author: ann.id, text: ' Hello ' })).isOk(),
    ).toBe(true)
    expect((await world.session.flush()).isOk()).toBe(true)

    const [note, ...others] = (await container.get(NOTES_SERVICE).read())._unsafeUnwrap()

    expect(others).toEqual([])
    expect(note?.text).toBe('Hello')
    expect(note?.author).toBe(ann.id)
    expect(world.tenantsOpened()).toEqual(['acme'])
  })

  it('routes signed-in users to the organisation page', () => {
    expect(OrganisationModule.routes).toEqual([
      { path: '/org', page: 'OrganisationPage', guard: 'authenticated' },
    ])
    expect(Object.keys(OrganisationModule.declarations)).toEqual(['OrganisationPage'])
  })
})
