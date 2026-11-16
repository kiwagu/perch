import { ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openTestDb, readSchema } from '@workspace/data/testing'
import { idSchemas, invitationIdFactory, profileIdFactory } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import { membership, tenantRole } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

import type { GatewayRoot } from '../../composition/root'
import { DIRECTORY, NAMESPACE } from '../../config'
import { RequestLimits } from '../../limits/request-limits'
import { specInvitations } from '../__fixtures__/invitations'
import {
  ADDRESS,
  answer,
  closeHarness,
  deviceOf,
  failures,
  harness,
  request,
  routeOptions,
  type SignedUp,
} from '../__fixtures__/organisation-routes'
import { organisationsRetelling, specRetell } from '../__fixtures__/retell'
import { Organisations } from '../organisations'
import membershipRemoveStatement from '../surql/membership-remove.surql'
import membershipSetRoleStatement from '../surql/membership-set-role.surql'
import tenantReadyStatement from '../surql/tenant-ready.surql'

import { INVITE_FLOOR_MS } from './invitation-handlers'
import { organisationRoutes } from './routes'

/** What a creation answers. */
const created = z.object({ membership })

/** What an invite answers. */
const invitationAnswer = z.object({
  invitation: z.object({
    id: idSchemas.invitation.schema,
    email: z.string(),
    role: tenantRole,
    link: z.string(),
  }),
})

/** What the list of an organisation's invitations answers. */
const pending = z.object({ invitations: z.array(invitationAnswer.shape.invitation) })

/** The body of an admin inviting `email` as a member. */
const asMember = (email: string) => ({ email, role: 'member' })

afterEach(closeHarness)

/** A member as the member list answers it. */
function memberOf(signedUp: SignedUp, role: 'admin' | 'member') {
  return { identity: signedUp.identity, role }
}

describe('organisationRoutes', () => {
  it('lists the memberships of the identity whose session the token holds', async () => {
    const { ann, bob, ask, founded } = await harness()
    const acme = await founded()

    expect(await ask('GET', '/organisations', { as: ann })).toEqual({
      status: 200,
      body: { memberships: [acme] },
    })
    expect(await ask('GET', '/organisations', { as: bob })).toEqual({
      status: 200,
      body: { memberships: [] },
    })
  })

  it('creates an organisation with the caller as its admin and answers 201 with the membership', async () => {
    const { ann, ask } = await harness()
    const { status, body } = await ask('POST', '/organisations', {
      as: ann,
      body: { key: 'acme', name: '  Acme  ' },
    })
    const answered = created.parse(body).membership

    expect(status).toBe(201)
    expect(answered.tenant.id).toMatch(/^tnt_/)
    expect(answered).toEqual({
      tenant: { id: answered.tenant.id, key: 'acme', name: 'Acme' },
      role: 'admin',
    })
    expect(await ask('GET', '/organisations', { as: ann })).toEqual({
      status: 200,
      body: { memberships: [answered] },
    })
  })

  it('answers 400 to a creation whose body does not follow the schema, and creates nothing', async () => {
    const { ann, ask } = await harness()

    for (const body of [
      { key: 'Acme', name: 'Acme' },
      { key: 'a', name: 'Acme' },
      { key: 'acme-corp', name: 'Acme' },
      { key: 'acme', name: '   ' },
      { key: 'acme', name: 'x'.repeat(81) },
      { key: 'acme' },
      '{"key":',
    ]) {
      expect(await ask('POST', '/organisations', { as: ann, body })).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }

    expect(await ask('GET', '/organisations', { as: ann })).toEqual({
      status: 200,
      body: { memberships: [] },
    })
  })

  it('creates the organisation for the caller, whatever identity the body names', async () => {
    const { ann, bob, ask } = await harness()
    const { status, body } = await ask('POST', '/organisations', {
      as: ann,
      body: { key: 'acme', name: 'Acme', identity: bob.identity.id },
    })
    const answered = created.parse(body).membership

    expect(status).toBe(201)
    expect(await ask('GET', '/organisations', { as: ann })).toEqual({
      status: 200,
      body: { memberships: [answered] },
    })
    expect(await ask('GET', '/organisations', { as: bob })).toEqual({
      status: 200,
      body: { memberships: [] },
    })
  })

  it('answers 409 to a key another identity took', async () => {
    const { bob, ask, founded } = await harness()

    await founded()

    expect(
      await ask('POST', '/organisations', { as: bob, body: { key: 'acme', name: 'Acme too' } }),
    ).toEqual({ status: 409, body: { code: 'key-taken' } })
  })

  it('lists the members with their emails to an admin', async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin'), memberOf(bob, 'member')] },
    })
  })

  it('answers 403 to a member asking for the members', async () => {
    const { bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(await ask('GET', '/organisations/acme/members', { as: bob })).toEqual({
      status: 403,
      body: { code: 'not-admin' },
    })
  })

  it('answers 403 to an outsider asking for the members', async () => {
    const { cat, ask, founded } = await harness()

    await founded()

    expect(await ask('GET', '/organisations/acme/members', { as: cat })).toEqual({
      status: 403,
      body: { code: 'not-a-member' },
    })
  })

  it('answers 404 to the members of an organisation that does not exist', async () => {
    const { ann, ask } = await harness()

    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 404,
      body: { code: 'no-such-tenant' },
    })
  })

  it('answers 405 with Allow: GET to the direct add of a member, which no longer exists', async () => {
    const { ann, routes, founded } = await harness()

    await founded()

    const response = await routes(
      request('POST', '/organisations/acme/members', {
        as: ann,
        body: { email: 'bob@example.test' },
      }),
      ADDRESS,
    )

    expect(await answer(response)).toEqual({ status: 405, body: { code: 'method-not-allowed' } })
    expect(response?.headers.get('allow')).toBe('GET')
  })

  it('invites an email with an account and one without alike: 201 with the same keys, a mail to each carrying the answered link', async () => {
    const { ann, ask, founded, outbox } = await harness()

    await founded()

    const known = await ask('POST', '/organisations/acme/invitations', {
      as: ann,
      body: asMember('bob@example.test'),
    })
    const unknown = await ask('POST', '/organisations/acme/invitations', {
      as: ann,
      body: { email: 'dan@example.test', role: 'admin' },
    })

    expect([known.status, unknown.status]).toEqual([201, 201])

    const withAccount = invitationAnswer.parse(known.body).invitation
    const withoutAccount = invitationAnswer.parse(unknown.body).invitation

    expect(Object.keys(withAccount).sort()).toEqual(['email', 'id', 'link', 'role'])
    expect(Object.keys(withoutAccount).sort()).toEqual(Object.keys(withAccount).sort())
    expect(withAccount).toEqual({
      id: withAccount.id,
      email: 'bob@example.test',
      role: 'member',
      link: withAccount.link,
    })
    expect(withoutAccount).toMatchObject({ email: 'dan@example.test', role: 'admin' })

    const url = new URL(withAccount.link)

    expect(url.origin + url.pathname).toBe('http://localhost/invitation')
    expect(url.searchParams.get('token')).not.toBe('')
    // Bob's verification mail is his first: the invitation's is the second, and Dan's the first.
    expect((await outbox.next('bob@example.test', 1)).text).toContain(withAccount.link)
    expect((await outbox.next('dan@example.test')).text).toContain(withoutAccount.link)
  })

  it('answers an accepted invite no sooner than the floor after it began, an email with an account and one without alike, and a mail that never settles delays it no further', async () => {
    const { ann, routes, floor, founded, outbox } = await harness()

    await founded()

    const send = vi
      .spyOn(outbox, 'send')
      .mockImplementation(() => new ResultAsync(new Promise(() => {})))
    const asked = ['bob@example.test', 'dan@example.test'].map((email) => {
      const state = { settled: false }
      const answered = routes(
        request('POST', '/organisations/acme/invitations', { as: ann, body: asMember(email) }),
        ADDRESS,
      ).finally(() => {
        state.settled = true
      })

      return { state, answered }
    })

    await vi.waitFor(() => expect(floor.pending()).toBe(2))
    await floor.advance(INVITE_FLOOR_MS - 1)
    expect(asked.map(({ state }) => state.settled)).toEqual([false, false])
    await floor.advance(1)

    const answers = await Promise.all(asked.map(({ answered }) => answered))

    expect(answers.map((each) => each?.status)).toEqual([201, 201])
    // Both mails were started, and neither ever settled.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  })

  it('answers a refused invite without the floor: a member of the organisation is told so at once', async () => {
    const { ann, routes, floor, founded, invited } = await harness()

    await founded()
    await invited()

    const refused = await routes(
      request('POST', '/organisations/acme/invitations', {
        as: ann,
        body: asMember('BOB@example.test'),
      }),
      ADDRESS,
    )

    expect(await answer(refused)).toEqual({ status: 409, body: { code: 'already-member' } })
    expect(floor.pending()).toBe(0)
  })

  it('answers 400 email-invalid to an email the gateway does not take, as an attempt it counts', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    for (const email of ['bob', 'bob@', '', `${'a'.repeat(250)}@example.test`]) {
      expect(
        await ask('POST', '/organisations/acme/invitations', { as: ann, body: asMember(email) }),
      ).toEqual({ status: 400, body: { code: 'email-invalid' } })
    }
  })

  it('answers 400 bad-request to an invite whose body does not follow the schema', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    for (const body of [
      { email: 'bob@example.test', role: 'owner' },
      { email: 'bob@example.test', role: 'ADMIN' },
      { email: 'bob@example.test' },
      { role: 'member' },
      { email: 5, role: 'member' },
      {},
      '{"email":',
    ]) {
      expect(await ask('POST', '/organisations/acme/invitations', { as: ann, body })).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }
  })

  it('answers 403 to an invite from a member who is not admin and from an outsider', async () => {
    const { bob, cat, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('POST', '/organisations/acme/invitations', {
        as: bob,
        body: asMember('cat@example.test'),
      }),
    ).toEqual({ status: 403, body: { code: 'not-admin' } })
    expect(
      await ask('POST', '/organisations/acme/invitations', {
        as: cat,
        body: asMember('cat@example.test'),
      }),
    ).toEqual({ status: 403, body: { code: 'not-a-member' } })
  })

  it('answers 404 to an invite into an organisation that does not exist', async () => {
    const { ann, ask } = await harness()

    expect(
      await ask('POST', '/organisations/acme/invitations', {
        as: ann,
        body: asMember('bob@example.test'),
      }),
    ).toEqual({ status: 404, body: { code: 'no-such-tenant' } })
  })

  it("answers 409 to an invite of a member's email, in any case", async () => {
    const { ann, ask, founded, invited } = await harness()

    await founded()
    await invited()

    for (const email of ['bob@example.test', 'Bob@Example.TEST']) {
      expect(
        await ask('POST', '/organisations/acme/invitations', { as: ann, body: asMember(email) }),
      ).toEqual({ status: 409, body: { code: 'already-member' } })
    }
  })

  it('lists the pending invitations newest first with the links that were mailed, to an admin only', async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    const first = invitationAnswer.parse(
      (
        await ask('POST', '/organisations/acme/invitations', {
          as: ann,
          body: asMember('dan@example.test'),
        })
      ).body,
    ).invitation
    const second = invitationAnswer.parse(
      (
        await ask('POST', '/organisations/acme/invitations', {
          as: ann,
          body: { email: 'eve@example.test', role: 'admin' },
        })
      ).body,
    ).invitation

    expect(await ask('GET', '/organisations/acme/invitations', { as: ann })).toEqual({
      status: 200,
      body: { invitations: [second, first] },
    })
    expect(await ask('GET', '/organisations/acme/invitations', { as: bob })).toEqual({
      status: 403,
      body: { code: 'not-admin' },
    })
  })

  it("replaces an email's invitation when it is invited again: one is listed, with the new role", async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    const old = invitationAnswer.parse(
      (
        await ask('POST', '/organisations/acme/invitations', {
          as: ann,
          body: asMember('dan@example.test'),
        })
      ).body,
    ).invitation
    const again = invitationAnswer.parse(
      (
        await ask('POST', '/organisations/acme/invitations', {
          as: ann,
          body: { email: 'dan@example.test', role: 'admin' },
        })
      ).body,
    ).invitation

    expect(again.id).not.toBe(old.id)
    expect(
      pending.parse((await ask('GET', '/organisations/acme/invitations', { as: ann })).body),
    ).toEqual({
      invitations: [again],
    })
  })

  it('revokes an invitation with 204, also one already gone, and nothing of another organisation', async () => {
    const { root, ann, bob, ask, founded } = await harness()

    await founded()
    ;(
      await root.organisations.create({ identity: bob.identity.id, key: 'bobco', name: 'Bob Co' })
    )._unsafeUnwrap()

    const mine = invitationAnswer.parse(
      (
        await ask('POST', '/organisations/acme/invitations', {
          as: ann,
          body: asMember('dan@example.test'),
        })
      ).body,
    ).invitation
    const theirs = invitationAnswer.parse(
      (
        await ask('POST', '/organisations/bobco/invitations', {
          as: bob,
          body: asMember('dan@example.test'),
        })
      ).body,
    ).invitation

    // Ann names Bob's invitation in her own organisation's path: nothing is deleted.
    expect(
      await ask('DELETE', `/organisations/acme/invitations/${theirs.id}`, { as: ann }),
    ).toEqual({ status: 204, body: undefined })
    expect((await ask('GET', '/organisations/bobco/invitations', { as: bob })).body).toEqual({
      invitations: [theirs],
    })

    for (const attempt of [mine.id, mine.id, invitationIdFactory.create()]) {
      expect(
        await ask('DELETE', `/organisations/acme/invitations/${attempt}`, { as: ann }),
      ).toEqual({ status: 204, body: undefined })
    }

    expect((await ask('GET', '/organisations/acme/invitations', { as: ann })).body).toEqual({
      invitations: [],
    })
  })

  it('answers 400 to a revocation whose path names no invitation, and 403 to a member who is not admin', async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    for (const invitation of ['dan', profileIdFactory.create()]) {
      expect(
        await ask('DELETE', `/organisations/acme/invitations/${invitation}`, { as: ann }),
      ).toEqual({ status: 400, body: { code: 'bad-request' } })
    }

    expect(
      await ask('DELETE', `/organisations/acme/invitations/${invitationIdFactory.create()}`, {
        as: bob,
      }),
    ).toEqual({ status: 403, body: { code: 'not-admin' } })
  })

  it("changes a member's role with 204: the members list says so", async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('PATCH', `/organisations/acme/members/${bob.identity.id}`, {
        as: ann,
        body: { role: 'admin' },
      }),
    ).toEqual({ status: 204, body: undefined })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin'), memberOf(bob, 'admin')] },
    })
    expect(
      await ask('PATCH', `/organisations/acme/members/${bob.identity.id}`, {
        as: ann,
        body: { role: 'member' },
      }),
    ).toEqual({ status: 204, body: undefined })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin'), memberOf(bob, 'member')] },
    })
  })

  it('answers 409 last-admin to the only admin demoting itself, and changes nothing', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    expect(
      await ask('PATCH', `/organisations/acme/members/${ann.identity.id}`, {
        as: ann,
        body: { role: 'member' },
      }),
    ).toEqual({ status: 409, body: { code: 'last-admin' } })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin')] },
    })
  })

  it('answers 400 to a role change whose path or body does not follow the schema', async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    for (const [identity, body] of [
      [bob.identity.id, { role: 'owner' }],
      [bob.identity.id, {}],
      [bob.identity.id, '{"role":'],
      ['bob', { role: 'admin' }],
      [profileIdFactory.create(), { role: 'admin' }],
    ] as const) {
      expect(
        await ask('PATCH', `/organisations/acme/members/${identity}`, { as: ann, body }),
      ).toEqual({ status: 400, body: { code: 'bad-request' } })
    }
  })

  it('answers 403 to a role change by a member who is not admin and by an outsider', async () => {
    const { ann, bob, cat, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('PATCH', `/organisations/acme/members/${ann.identity.id}`, {
        as: bob,
        body: { role: 'member' },
      }),
    ).toEqual({ status: 403, body: { code: 'not-admin' } })
    expect(
      await ask('PATCH', `/organisations/acme/members/${bob.identity.id}`, {
        as: cat,
        body: { role: 'admin' },
      }),
    ).toEqual({ status: 403, body: { code: 'not-a-member' } })
  })

  it('answers 404 to a role change of one who is no member, and in an organisation that does not exist', async () => {
    const { ann, cat, ask, founded } = await harness()

    expect(
      await ask('PATCH', `/organisations/acme/members/${cat.identity.id}`, {
        as: ann,
        body: { role: 'admin' },
      }),
    ).toEqual({ status: 404, body: { code: 'no-such-tenant' } })

    await founded()

    expect(
      await ask('PATCH', `/organisations/acme/members/${cat.identity.id}`, {
        as: ann,
        body: { role: 'admin' },
      }),
    ).toEqual({ status: 404, body: { code: 'no-such-member' } })
  })

  it('answers 401 to the invitation and role routes without a token that holds a live session', async () => {
    const { ann, bob, ask, founded } = await harness()
    const device = deviceOf(ann.identity.email)

    await founded()

    for (const [method, path, body] of [
      ['GET', '/organisations/acme/invitations', undefined],
      ['POST', '/organisations/acme/invitations', asMember('dan@example.test')],
      ['DELETE', `/organisations/acme/invitations/${invitationIdFactory.create()}`, undefined],
      ['PATCH', `/organisations/acme/members/${bob.identity.id}`, { role: 'admin' }],
    ] as const) {
      for (const authorization of [undefined, 'Bearer not-a-session-token']) {
        const sent = authorization === undefined ? { device } : { authorization, device }

        expect(await ask(method, path, body === undefined ? sent : { ...sent, body })).toEqual({
          status: 401,
          body: { code: 'unauthorized' },
        })
      }
    }
  })

  it('removes a member and answers 204 with no body', async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('DELETE', `/organisations/acme/members/${bob.identity.id}`, { as: ann }),
    ).toEqual({ status: 204, body: undefined })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin')] },
    })
    expect(await ask('GET', '/organisations', { as: bob })).toEqual({
      status: 200,
      body: { memberships: [] },
    })
  })

  it('answers 400 to a removal whose path does not name an identity', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    for (const identity of ['bob', profileIdFactory.create()]) {
      expect(await ask('DELETE', `/organisations/acme/members/${identity}`, { as: ann })).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }
  })

  it('answers 403 to a removal by an outsider, and removes nobody', async () => {
    const { ann, bob, cat, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('DELETE', `/organisations/acme/members/${bob.identity.id}`, { as: cat }),
    ).toEqual({ status: 403, body: { code: 'not-a-member' } })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin'), memberOf(bob, 'member')] },
    })
  })

  it('answers 204 to the removal of an identity that is not a member, and changes nothing', async () => {
    const { ann, cat, ask, founded } = await harness()

    await founded()

    expect(
      await ask('DELETE', `/organisations/acme/members/${cat.identity.id}`, { as: ann }),
    ).toEqual({ status: 204, body: undefined })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin')] },
    })
    expect(await ask('GET', '/organisations', { as: cat })).toEqual({
      status: 200,
      body: { memberships: [] },
    })
  })

  it('answers 403 to a removal by a member who is not admin', async () => {
    const { ann, bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('DELETE', `/organisations/acme/members/${ann.identity.id}`, { as: bob }),
    ).toEqual({ status: 403, body: { code: 'not-admin' } })
  })

  it('answers 404 to a removal from an organisation that does not exist', async () => {
    const { ann, bob, ask } = await harness()

    expect(
      await ask('DELETE', `/organisations/acme/members/${bob.identity.id}`, { as: ann }),
    ).toEqual({ status: 404, body: { code: 'no-such-tenant' } })
  })

  it('answers 409 to an admin removing itself', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    expect(
      await ask('DELETE', `/organisations/acme/members/${ann.identity.id}`, { as: ann }),
    ).toEqual({ status: 409, body: { code: 'self' } })
  })

  it('answers 401 to a request without a token that holds a live session, and does nothing', async () => {
    const { ann, ask } = await harness()

    for (const authorization of [
      undefined,
      `Basic ${btoa('ann@example.test:Pass-word-1')}`,
      'Bearer',
      'Bearer not-a-session-token',
      // The signed form of a token names no session here: a session ends by its raw token.
      `Bearer ${ann.token}.signature`,
    ]) {
      // From a device of Ann's: only the token is wrong.
      const device = deviceOf(ann.identity.email)
      const as = authorization === undefined ? { device } : { authorization, device }

      expect(await ask('GET', '/organisations', as)).toEqual({
        status: 401,
        body: { code: 'unauthorized' },
      })
      expect(
        await ask('POST', '/organisations', { ...as, body: { key: 'acme', name: 'Acme' } }),
      ).toEqual({ status: 401, body: { code: 'unauthorized' } })
    }

    expect(await ask('GET', '/organisations', { as: ann })).toEqual({
      status: 200,
      body: { memberships: [] },
    })
  })

  it('names the Bearer scheme in WWW-Authenticate when it answers 401', async () => {
    const { ann, routes } = await harness()
    const refused = await routes(
      request('GET', '/organisations', { device: deviceOf(ann.identity.email) }),
      ADDRESS,
    )

    expect(refused?.status).toBe(401)
    expect(refused?.headers.get('WWW-Authenticate')).toBe('Bearer')
  })

  it('answers 400 to a call that names no device, and 401 to a call of a device signed out', async () => {
    const { root, ann, ask } = await harness()

    for (const device of [null, '']) {
      expect(await ask('GET', '/organisations', { as: ann, device })).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }

    expect(await ask('GET', '/organisations', { as: ann, device: 'device-unlisted' })).toEqual({
      status: 401,
      body: { code: 'unauthorized' },
    })

    const [row] = (await root.deviceSessions.list(ann.identity.id))._unsafeUnwrap()

    ;(
      await root.sessions.revoke(
        ann.identity.id,
        row?.id ?? expect.unreachable("Ann's device listed"),
      )
    )._unsafeUnwrap()

    // The device was signed out from another one: its token holds no live session any more.
    expect(await ask('GET', '/organisations', { as: ann })).toEqual({
      status: 401,
      body: { code: 'unauthorized' },
    })
  })

  it("answers 500 to a failure that is not the caller's fault, and hands the failure to onFailure", async () => {
    const { root, ann } = await harness()
    const directory = (
      await openTestDb({
        namespace: NAMESPACE,
        database: DIRECTORY,
        schema: readSchema('directory'),
      })
    )._unsafeUnwrap()

    await directory.close()

    // Organisations over a directory that is gone: the session is still read on the root's.
    const routes = organisationRoutes(
      root.sessions,
      new Organisations({
        directory,
        databases: root.databases,
        revoke: (identity, region) => root.connections.revoke(identity, region),
        rerole: (identity, region, role) => root.connections.rerole(identity, region, role),
        hub: root.hub,
        invitations: specInvitations(directory),
        retell: specRetell(),
      }),
      routeOptions(new RequestLimits({ clock: manualClock() })),
    )

    expect(
      await answer(await routes(request('GET', '/organisations', { as: ann }), ADDRESS)),
    ).toEqual({ status: 500, body: { code: 'internal' } })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:QUERY_FAILED'])
  })

  it('answers 401 to a creation whose identity went before its turn, as to a token that holds no session, and creates nothing', async () => {
    const { root, ann } = await harness()
    // A directory where ann's identity is gone, as after her account's deletion: her session is
    // still read on the root's, as one read before the deletion ended it.
    const directory = (
      await openTestDb({
        namespace: NAMESPACE,
        database: DIRECTORY,
        schema: readSchema('directory'),
      })
    )._unsafeUnwrap()

    try {
      const organisations = new Organisations({
        directory,
        databases: root.databases,
        revoke: (identity, region) => root.connections.revoke(identity, region),
        rerole: (identity, region, role) => root.connections.rerole(identity, region, role),
        hub: root.hub,
        invitations: specInvitations(directory),
        retell: specRetell(),
      })
      const routes = organisationRoutes(
        root.sessions,
        organisations,
        routeOptions(new RequestLimits({ clock: manualClock() })),
      )
      const refused = await routes(
        request('POST', '/organisations', { as: ann, body: { key: 'acme', name: 'Acme' } }),
        ADDRESS,
      )

      expect(await answer(refused)).toEqual({ status: 401, body: { code: 'unauthorized' } })
      expect(refused?.headers.get('WWW-Authenticate')).toBe('Bearer')
      expect((await organisations.membershipsOf(ann.identity.id))._unsafeUnwrap()).toEqual([])
      expect((await root.organisations.membershipsOf(ann.identity.id))._unsafeUnwrap()).toEqual([])
    } finally {
      await directory.close()
    }
  })

  it('answers 405 with the methods a path takes to any other method', async () => {
    const { ann, bob, routes } = await harness()

    for (const [method, path, allow] of [
      ['PUT', '/organisations', 'GET, POST'],
      ['DELETE', '/organisations', 'GET, POST'],
      ['DELETE', '/organisations/acme/members', 'GET'],
      ['POST', '/organisations/acme/members', 'GET'],
      ['GET', `/organisations/acme/members/${bob.identity.id}`, 'PATCH, DELETE'],
      ['POST', `/organisations/acme/members/${bob.identity.id}`, 'PATCH, DELETE'],
      ['PUT', '/organisations/acme/invitations', 'GET, POST'],
      ['DELETE', '/organisations/acme/invitations', 'GET, POST'],
      ['GET', `/organisations/acme/invitations/${invitationIdFactory.create()}`, 'DELETE'],
      ['PATCH', `/organisations/acme/invitations/${invitationIdFactory.create()}`, 'DELETE'],
    ] as const) {
      const response = await routes(request(method, path, { as: ann }), ADDRESS)

      expect(await answer(response)).toEqual({
        status: 405,
        body: { code: 'method-not-allowed' },
      })
      expect(response?.headers.get('allow')).toBe(allow)
    }
  })

  it("takes a key in the path exactly when the kernel's key rule accepts it", async () => {
    const { ann, routes } = await harness()
    const keys = ['ab', 'acme_2026', 'a'.repeat(32), 'a', '1acme', 'Acme', 'acme-corp']

    for (const key of [...keys, 'a'.repeat(33), 'a'.repeat(40), 'a'.repeat(41)]) {
      const response = await routes(
        request('GET', `/organisations/${key}/members`, { as: ann }),
        ADDRESS,
      )

      expect({ key, matched: response !== undefined }).toEqual({ key, matched: isTenantKey(key) })
    }
  })

  it('leaves a path that is not its own to the caller', async () => {
    const { ann, routes } = await harness()

    for (const path of [
      '/organisations/',
      '/organisations/acme',
      '/organisations/Acme/members',
      '/organisations/acme-corp/members',
      '/organisations/acme/members/',
      '/organisations/acme/members/idn_x/more',
      '/organisations/acme/invitations/',
      '/organisations/acme/invitations/inv_x/more',
      '/organisations/acme/people',
      '/organisationsx',
      '/auth/sign-in',
    ]) {
      expect(await routes(request('GET', path, { as: ann }), ADDRESS)).toBeUndefined()
    }
  })
})

describe('organisationRoutes, a failed tell', () => {
  /** The organisation routes over organisations whose tell fails once after `statement`. */
  const retellingRoutes = (root: GatewayRoot, statement: string) => {
    const retelling = organisationsRetelling(root, statement)
    const routes = organisationRoutes(
      root.sessions,
      retelling.organisations,
      routeOptions(new RequestLimits({ clock: manualClock() })),
    )

    return { ...retelling, routes }
  }

  it('answers 201 to a creation whose tell failed, and the listeners hear the list after the delay', async () => {
    const { root, ann } = await harness()
    const { routes, heard, retold } = retellingRoutes(root, tenantReadyStatement)
    const { status, body } = await answer(
      await routes(
        request('POST', '/organisations', { as: ann, body: { key: 'acme', name: 'Acme' } }),
        ADDRESS,
      ),
    )
    const answered = created.parse(body).membership

    expect(status).toBe(201)
    expect(answered).toMatchObject({ tenant: { key: 'acme', name: 'Acme' }, role: 'admin' })
    expect(heard).toEqual([])

    await retold()

    expect(heard).toEqual([[ann.identity.id, [answered]]])
  })

  it('answers 204 to a role change whose tell failed, and the listeners hear the list after the delay', async () => {
    const { root, ann, bob, founded, invited } = await harness()
    const acme = await founded()

    await invited()

    const { routes, heard, retold } = retellingRoutes(root, membershipSetRoleStatement)

    expect(
      await answer(
        await routes(
          request('PATCH', `/organisations/acme/members/${bob.identity.id}`, {
            as: ann,
            body: { role: 'admin' },
          }),
          ADDRESS,
        ),
      ),
    ).toEqual({ status: 204, body: undefined })
    expect(heard).toEqual([])

    await retold()

    expect(heard).toEqual([[bob.identity.id, [{ tenant: acme.tenant, role: 'admin' }]]])
  })

  it('answers 204 to a removal whose tell failed, and the listeners hear the list after the delay', async () => {
    const { root, ann, bob, founded, invited } = await harness()

    await founded()
    await invited()

    const { routes, heard, retold } = retellingRoutes(root, membershipRemoveStatement)

    expect(
      await answer(
        await routes(
          request('DELETE', `/organisations/acme/members/${bob.identity.id}`, { as: ann }),
          ADDRESS,
        ),
      ),
    ).toEqual({ status: 204, body: undefined })
    expect(heard).toEqual([])

    await retold()

    expect(heard).toEqual([[bob.identity.id, []]])
  })
})
