import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { recordId } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import { invitationIdFactory, membershipIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

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
} from '../__fixtures__/organisation-routes'
import { Organisations } from '../organisations'
import membershipAddStatement from '../surql/membership-add.surql'

import { invitationRoutes } from './routes'

afterEach(closeHarness)

const DAY_MS = 24 * 60 * 60 * 1000

/** What the answer to a read of a link holds. */
const read = (organisation: string, role: 'member' | 'admin', forYou: boolean) => ({
  status: 200,
  body: { invitation: { organisation: { name: organisation }, role, forYou } },
})

/** What an accepted invitation answers. */
const accepted = z.object({ membership: z.object({ role: z.string() }) })

/** An organisation's refusal as the routes answer it. */
const refusal = (status: number, code: string) => ({ status, body: { code } })

/**
 * The harness, and `invite(email, role?, key?)`: Ann (who created acme and bobco) invites `email`
 * into an organisation, answering the invitation's id and the token of its link.
 */
async function invitedHarness() {
  const setup = await harness()
  const { root, ann } = setup

  await setup.founded()
  ;(
    await root.organisations.create({ identity: ann.identity.id, key: 'zeta', name: 'Zeta' })
  )._unsafeUnwrap()

  const invite = async (email: string, role: 'member' | 'admin' = 'member', key = 'acme') => {
    const view = (
      await root.organisations.invitations.invite({ actor: ann.identity.id, key, email, role })
    )._unsafeUnwrap()
    const token = new URL(view.link).searchParams.get('token')

    if (token === null) {
      return expect.unreachable('the link carries a token')
    }

    return { id: view.id, token }
  }

  return { ...setup, invite }
}

describe('invitationRoutes', () => {
  describe('POST /invitations/read', () => {
    it('shows a guest the organisation and the role, never the email, and the invited account that it is for it', async () => {
      const { ask, bob, cat, invite } = await invitedHarness()
      const { token } = await invite('bob@example.test', 'admin')

      const guest = await ask('POST', '/invitations/read', { body: { token } })

      expect(guest).toEqual(read('Acme', 'admin', false))
      expect(JSON.stringify(guest.body)).not.toContain('bob@example.test')
      expect(await ask('POST', '/invitations/read', { as: bob, body: { token } })).toEqual(
        read('Acme', 'admin', true),
      )
      expect(await ask('POST', '/invitations/read', { as: cat, body: { token } })).toEqual(
        read('Acme', 'admin', false),
      )
    })

    it("answers 401 to a token of a session that is not live, as it does to a guest's none", async () => {
      const { ask, ann, invite } = await invitedHarness()
      const { token } = await invite('bob@example.test')
      const device = deviceOf(ann.identity.email)

      for (const authorization of ['Bearer not-a-session-token', `Bearer ${ann.token}.signature`]) {
        expect(
          await ask('POST', '/invitations/read', { authorization, device, body: { token } }),
        ).toEqual(refusal(401, 'unauthorized'))
      }
    })

    it('answers 404 link-invalid to a token that names nothing and to one an admin revoked or replaced', async () => {
      const { ask, ann, invite } = await invitedHarness()
      const first = await invite('bob@example.test')

      expect(await ask('POST', '/invitations/read', { body: { token: 'not-a-token' } })).toEqual(
        refusal(404, 'link-invalid'),
      )

      await invite('bob@example.test', 'admin')

      expect(await ask('POST', '/invitations/read', { body: { token: first.token } })).toEqual(
        refusal(404, 'link-invalid'),
      )

      const second = await invite('dan@example.test')

      await ask('DELETE', `/organisations/acme/invitations/${second.id}`, { as: ann })

      expect(await ask('POST', '/invitations/read', { body: { token: second.token } })).toEqual(
        refusal(404, 'link-invalid'),
      )
    })

    it('answers 410 link-expired to a link of a week past', async () => {
      const { ask, time, invite } = await invitedHarness()
      const { token } = await invite('bob@example.test')

      await time.advance(7 * DAY_MS + 1)

      expect(await ask('POST', '/invitations/read', { body: { token } })).toEqual(
        refusal(410, 'link-expired'),
      )
    })

    it('answers 400 to a body that does not follow the schema', async () => {
      const { ask } = await invitedHarness()

      for (const body of [
        {},
        { token: '' },
        { token: 5 },
        { token: 'x'.repeat(4097) },
        '{"token":',
      ]) {
        expect(await ask('POST', '/invitations/read', { body })).toEqual(
          refusal(400, 'bad-request'),
        )
      }
    })

    it('takes 20 reads of an address within 10 minutes, whatever the token, and answers the 21st 429 before the body is parsed', async () => {
      const { root, ask, bob, invite } = await invitedHarness()
      const { token } = await invite('bob@example.test')
      const reading = vi.spyOn(root.organisations.invitations, 'read')

      // Bodies of any kind count: the limit is taken before the body is read.
      for (let n = 0; n < 20; n += 1) {
        const body = n % 2 === 0 ? { token: `unknown-${n}` } : '{"token":'

        expect((await ask('POST', '/invitations/read', { body })).status).toBeGreaterThanOrEqual(
          400,
        )
      }

      expect(reading).toHaveBeenCalledTimes(10)

      for (const sent of [
        { body: { token } },
        { body: '{"token":' },
        { body: {} },
        { as: bob, body: { token } },
        {
          authorization: 'Bearer not-a-session-token',
          device: deviceOf('bob@example.test'),
          body: { token },
        },
      ]) {
        const response = await ask('POST', '/invitations/read', sent)

        expect(response).toEqual(refusal(429, 'rate-limited'))
      }

      expect(reading).toHaveBeenCalledTimes(10)
    })

    it('answers 429 with Retry-After in whole seconds, and lets another address read', async () => {
      const { invitations, ask, invite, limits } = await invitedHarness()
      const { token } = await invite('bob@example.test')

      for (let n = 0; n < 20; n += 1) {
        await invitations(request('POST', '/invitations/read', { body: { token } }), ADDRESS)
      }

      const refused = await invitations(
        request('POST', '/invitations/read', { body: { token } }),
        ADDRESS,
      )

      expect(refused?.status).toBe(429)
      expect(refused?.headers.get('Retry-After')).toBe('600')
      expect(
        await ask('POST', '/invitations/read', { from: '203.0.113.2', body: { token } }),
      ).toEqual(read('Acme', 'member', false))
      // A window of its own: the other kinds of link attempts of the address are untouched.
      expect(limits.passwordReset(ADDRESS)).toEqual({ allowed: true })
      expect(limits.accountDeletion(ADDRESS)).toEqual({ allowed: true })
      expect(limits.emailConfirmation(ADDRESS)).toEqual({ allowed: true })
    })

    it('lets the address read again 10 minutes after the window started', async () => {
      const { ask, clock, invite } = await invitedHarness()
      const { token } = await invite('bob@example.test')

      for (let n = 0; n < 21; n += 1) {
        await ask('POST', '/invitations/read', { body: { token } })
      }

      await clock.advance(10 * 60_000)

      expect(await ask('POST', '/invitations/read', { body: { token } })).toEqual(
        read('Acme', 'member', false),
      )
    })
  })

  describe('GET /invitations', () => {
    it("lists the signed-in account's invitations newest first, each with the organisation's name and the role, and nothing for an account with none", async () => {
      const { ask, bob, cat, invite } = await invitedHarness()

      expect(await ask('GET', '/invitations', { as: bob })).toEqual({
        status: 200,
        body: { invitations: [] },
      })

      const acme = await invite('bob@example.test')
      const zeta = await invite('bob@example.test', 'admin', 'zeta')

      expect(await ask('GET', '/invitations', { as: bob })).toEqual({
        status: 200,
        body: {
          invitations: [
            { id: zeta.id, organisation: { name: 'Zeta' }, role: 'admin' },
            { id: acme.id, organisation: { name: 'Acme' }, role: 'member' },
          ],
        },
      })
      expect(await ask('GET', '/invitations', { as: cat })).toEqual({
        status: 200,
        body: { invitations: [] },
      })
    })
  })

  describe('POST /invitations/accept', () => {
    it('makes the account a member by the invitation id, with the invitation role, and answers 200 with the membership', async () => {
      const { ask, bob, invite } = await invitedHarness()
      const { id } = await invite('bob@example.test', 'admin')
      const { status, body } = await ask('POST', '/invitations/accept', {
        as: bob,
        body: { invitation: id },
      })

      expect(status).toBe(200)
      expect(accepted.parse(body).membership.role).toBe('admin')
      expect(await ask('GET', '/organisations', { as: bob })).toMatchObject({
        status: 200,
        body: { memberships: [{ tenant: { key: 'acme', name: 'Acme' }, role: 'admin' }] },
      })
      expect(await ask('GET', '/invitations', { as: bob })).toEqual({
        status: 200,
        body: { invitations: [] },
      })
    })

    it("makes the account a member by the token of the invitation's link", async () => {
      const { ask, bob, invite } = await invitedHarness()
      const { token } = await invite('bob@example.test')

      expect(
        (await ask('POST', '/invitations/accept', { as: bob, body: { invitation: token } })).status,
      ).toBe(200)
      expect(await ask('GET', '/organisations', { as: bob })).toMatchObject({
        body: { memberships: [{ tenant: { key: 'acme' }, role: 'member' }] },
      })
    })

    it("answers 403 other-account to another account's invitation, by id or by token, and makes no member", async () => {
      const { ask, bob, cat, invite } = await invitedHarness()
      const { id, token } = await invite('bob@example.test')

      for (const invitation of [id, token]) {
        expect(await ask('POST', '/invitations/accept', { as: cat, body: { invitation } })).toEqual(
          refusal(403, 'other-account'),
        )
      }

      expect(await ask('GET', '/organisations', { as: cat })).toEqual({
        status: 200,
        body: { memberships: [] },
      })
      expect(await ask('GET', '/invitations', { as: bob })).toMatchObject({
        body: { invitations: [{ id }] },
      })
    })

    it('answers 409 already-member to a member who accepts, and keeps the invitation', async () => {
      const { root, ask, ann, bob, invite } = await invitedHarness()
      const { id } = await invite('bob@example.test')
      const acme = (await root.organisations.membershipsOf(ann.identity.id))
        ._unsafeUnwrap()
        .find((each) => each.tenant.key === 'acme')

      // Bob became a member another way after the invitation was made.
      await root.local.db.query(membershipAddStatement, {
        id: membershipIdFactory.create(),
        identity: recordId('identity', bob.identity.id),
        tenant: recordId('tenant', acme?.tenant.id ?? expect.unreachable('acme exists')),
        role: 'member',
      })

      expect(
        await ask('POST', '/invitations/accept', { as: bob, body: { invitation: id } }),
      ).toEqual(refusal(409, 'already-member'))
      expect(
        (await root.organisations.invitations.pending({ actor: ann.identity.id, key: 'acme' }))
          ._unsafeUnwrap()
          .map((each) => each.id),
      ).toEqual([id])
    })

    it('answers 410 invitation-gone to an invitation that is unknown, revoked, replaced, spent or unreadable', async () => {
      const { ask, ann, bob, invite } = await invitedHarness()
      const revoked = await invite('bob@example.test')

      await ask('DELETE', `/organisations/acme/invitations/${revoked.id}`, { as: ann })

      const replaced = await invite('bob@example.test')
      const current = await invite('bob@example.test', 'admin')
      const spent = await invite('bob@example.test', 'member', 'zeta')

      expect(
        (await ask('POST', '/invitations/accept', { as: bob, body: { invitation: spent.id } }))
          .status,
      ).toBe(200)

      for (const invitation of [
        invitationIdFactory.create(),
        revoked.id,
        revoked.token,
        replaced.id,
        replaced.token,
        spent.id,
        spent.token,
        'not-a-token',
      ]) {
        expect(await ask('POST', '/invitations/accept', { as: bob, body: { invitation } })).toEqual(
          refusal(410, 'invitation-gone'),
        )
      }

      // The invitation that stands is still there to accept.
      expect(
        (await ask('POST', '/invitations/accept', { as: bob, body: { invitation: current.id } }))
          .status,
      ).toBe(200)
    })

    it('answers 410 invitation-gone to a link of a week past', async () => {
      const { ask, bob, time, invite } = await invitedHarness()
      const { id, token } = await invite('bob@example.test')

      await time.advance(7 * DAY_MS + 1)

      for (const invitation of [id, token]) {
        expect(await ask('POST', '/invitations/accept', { as: bob, body: { invitation } })).toEqual(
          refusal(410, 'invitation-gone'),
        )
      }
    })

    it('answers 401, as to a token that holds no session, when the account is gone by the answer', async () => {
      const { root, invitations, bob } = await invitedHarness()

      vi.spyOn(root.organisations.invitations, 'accept').mockReturnValue(
        errAsync({ kind: 'refused', code: 'no-such-identity' }),
      )

      const refused = await invitations(
        request('POST', '/invitations/accept', { as: bob, body: { invitation: 'inv_x' } }),
        ADDRESS,
      )

      expect(await answer(refused)).toEqual(refusal(401, 'unauthorized'))
      expect(refused?.headers.get('WWW-Authenticate')).toBe('Bearer')
    })

    it('answers 400 to a body that does not follow the schema', async () => {
      const { ask, bob } = await invitedHarness()

      for (const body of [
        {},
        { invitation: '' },
        { invitation: 5 },
        { invitation: 'x'.repeat(4097) },
        '{"invitation":',
      ]) {
        expect(await ask('POST', '/invitations/accept', { as: bob, body })).toEqual(
          refusal(400, 'bad-request'),
        )
      }
    })
  })

  describe('POST /invitations/decline', () => {
    it("spends the invitation by its id or its link's token, answers 204 and makes no member", async () => {
      const { ask, bob, invite } = await invitedHarness()
      const byId = await invite('bob@example.test')
      const byToken = await invite('bob@example.test', 'admin', 'zeta')

      expect(
        await ask('POST', '/invitations/decline', { as: bob, body: { invitation: byId.id } }),
      ).toEqual({ status: 204, body: undefined })
      expect(
        await ask('POST', '/invitations/decline', { as: bob, body: { invitation: byToken.token } }),
      ).toEqual({ status: 204, body: undefined })
      expect(await ask('GET', '/invitations', { as: bob })).toEqual({
        status: 200,
        body: { invitations: [] },
      })
      expect(await ask('GET', '/organisations', { as: bob })).toEqual({
        status: 200,
        body: { memberships: [] },
      })
      expect(await ask('POST', '/invitations/read', { body: { token: byId.token } })).toEqual(
        refusal(404, 'link-invalid'),
      )
    })

    it("answers 403 other-account to another account's invitation, keeping it", async () => {
      const { ask, bob, cat, invite } = await invitedHarness()
      const { id } = await invite('bob@example.test')

      expect(
        await ask('POST', '/invitations/decline', { as: cat, body: { invitation: id } }),
      ).toEqual(refusal(403, 'other-account'))
      expect(await ask('GET', '/invitations', { as: bob })).toMatchObject({
        body: { invitations: [{ id }] },
      })
    })

    it('answers 410 invitation-gone to an invitation that is gone', async () => {
      const { ask, bob, invite } = await invitedHarness()
      const { id } = await invite('bob@example.test')

      await ask('POST', '/invitations/decline', { as: bob, body: { invitation: id } })

      for (const invitation of [id, invitationIdFactory.create(), 'not-a-token']) {
        expect(
          await ask('POST', '/invitations/decline', { as: bob, body: { invitation } }),
        ).toEqual(refusal(410, 'invitation-gone'))
      }
    })

    it('answers 401, as to a token that holds no session, when the account is gone by the answer', async () => {
      const { root, invitations, bob } = await invitedHarness()

      vi.spyOn(root.organisations.invitations, 'decline').mockReturnValue(
        errAsync({ kind: 'refused', code: 'no-such-identity' }),
      )

      const refused = await invitations(
        request('POST', '/invitations/decline', { as: bob, body: { invitation: 'inv_x' } }),
        ADDRESS,
      )

      expect(await answer(refused)).toEqual(refusal(401, 'unauthorized'))
      expect(refused?.headers.get('WWW-Authenticate')).toBe('Bearer')
    })

    it('answers 400 to a body that does not follow the schema', async () => {
      const { ask, bob } = await invitedHarness()

      for (const body of [{}, { invitation: '' }, '{"invitation":']) {
        expect(await ask('POST', '/invitations/decline', { as: bob, body })).toEqual(
          refusal(400, 'bad-request'),
        )
      }
    })
  })

  describe('every route', () => {
    it('answers 401 to a signed-in route without a token that holds a live session', async () => {
      const { ask, bob } = await invitedHarness()
      const device = deviceOf(bob.identity.email)

      for (const [method, path, body] of [
        ['GET', '/invitations', undefined],
        ['POST', '/invitations/accept', { invitation: invitationIdFactory.create() }],
        ['POST', '/invitations/decline', { invitation: invitationIdFactory.create() }],
      ] as const) {
        for (const authorization of [undefined, 'Bearer not-a-session-token']) {
          const sent = authorization === undefined ? { device } : { authorization, device }

          expect(await ask(method, path, body === undefined ? sent : { ...sent, body })).toEqual(
            refusal(401, 'unauthorized'),
          )
        }
      }
    })

    it('answers 400 to a signed-in call that names no device', async () => {
      const { ask, bob } = await invitedHarness()

      expect(await ask('GET', '/invitations', { as: bob, device: null })).toEqual(
        refusal(400, 'bad-request'),
      )
    })

    it('answers 405 with the method a path takes to any other method', async () => {
      const { invitations, bob } = await invitedHarness()

      for (const [method, path, allow] of [
        ['GET', '/invitations/read', 'POST'],
        ['PUT', '/invitations/read', 'POST'],
        ['POST', '/invitations', 'GET'],
        ['DELETE', '/invitations', 'GET'],
        ['GET', '/invitations/accept', 'POST'],
        ['GET', '/invitations/decline', 'POST'],
        ['DELETE', '/invitations/decline', 'POST'],
      ] as const) {
        const response = await invitations(request(method, path, { as: bob }), ADDRESS)

        expect(await answer(response)).toEqual(refusal(405, 'method-not-allowed'))
        expect(response?.headers.get('allow')).toBe(allow)
      }
    })

    it('leaves a path that is not its own to the caller, a token in a path included', async () => {
      const { invitations, bob } = await invitedHarness()

      for (const path of [
        '/invitations/',
        `/invitations/${invitationIdFactory.create()}`,
        '/invitations/some-token',
        '/invitations/read/more',
        '/invitations/accept/',
        '/invitationsx',
        '/organisations/acme/invitations',
      ]) {
        expect(await invitations(request('GET', path, { as: bob }), ADDRESS)).toBeUndefined()
      }
    })

    it("answers 500 to a failure that is not the caller's fault, and hands the failure to onFailure", async () => {
      const { root, bob } = await invitedHarness()
      const directory = (
        await openTestDb({
          namespace: NAMESPACE,
          database: DIRECTORY,
          schema: readSchema('directory'),
        })
      )._unsafeUnwrap()

      await directory.close()

      // Organisations over a directory that is gone: the session is still read on the root's.
      const routes = invitationRoutes(
        root.sessions,
        new Organisations({
          directory,
          databases: root.databases,
          revoke: (identity, region) => root.connections.revoke(identity, region),
          rerole: (identity, region, role) => root.connections.rerole(identity, region, role),
          hub: root.hub,
          invitations: specInvitations(directory),
        }),
        routeOptions(new RequestLimits({ clock: manualClock() })),
      )

      expect(
        await answer(await routes(request('GET', '/invitations', { as: bob }), ADDRESS)),
      ).toEqual({ status: 500, body: { code: 'internal' } })
      expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:QUERY_FAILED'])
    })
  })
})
