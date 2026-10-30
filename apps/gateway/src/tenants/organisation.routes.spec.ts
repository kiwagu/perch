import { afterEach, describe, expect, it } from 'vitest'

import { openTestDb, readSchema } from '@workspace/data/testing'
import { profileIdFactory } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import { membership } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

import type { SignedIn } from '../auth/identity-sessions'
import { DIRECTORY, NAMESPACE } from '../config'
import { RequestLimits } from '../limits/request-limits'

import {
  ADDRESS,
  answer,
  closeHarness,
  deviceOf,
  failures,
  harness,
  request,
  routeOptions,
} from './__fixtures__/organisation-routes'
import { organisationRoutes } from './organisation.routes'
import { Organisations } from './organisations'

/** What a creation answers. */
const created = z.object({ membership })

afterEach(closeHarness)

/** A member as the member list answers it. */
function memberOf(signedIn: SignedIn, role: 'admin' | 'member') {
  return { identity: signedIn.identity, role }
}

describe('organisationRoutes', () => {
  it('lists the memberships of the identity its access token signs in', async () => {
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

  it('invites an identity by email and answers 200 with the member', async () => {
    const { ann, bob, ask, founded } = await harness()

    await founded()

    expect(
      await ask('POST', '/organisations/acme/members', {
        as: ann,
        body: { email: 'bob@example.test' },
      }),
    ).toEqual({ status: 200, body: { member: memberOf(bob, 'member') } })
    expect(await ask('GET', '/organisations/acme/members', { as: ann })).toEqual({
      status: 200,
      body: { members: [memberOf(ann, 'admin'), memberOf(bob, 'member')] },
    })
  })

  it('answers 400 to an invite whose body does not follow the schema', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    for (const body of [{ email: 'bob' }, {}, '{"email":']) {
      expect(await ask('POST', '/organisations/acme/members', { as: ann, body })).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }
  })

  it('answers 403 to an invite from a member who is not admin', async () => {
    const { bob, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('POST', '/organisations/acme/members', {
        as: bob,
        body: { email: 'cat@example.test' },
      }),
    ).toEqual({ status: 403, body: { code: 'not-admin' } })
  })

  it('answers 403 to an invite from an outsider', async () => {
    const { cat, ask, founded } = await harness()

    await founded()

    expect(
      await ask('POST', '/organisations/acme/members', {
        as: cat,
        body: { email: 'cat@example.test' },
      }),
    ).toEqual({ status: 403, body: { code: 'not-a-member' } })
  })

  it('answers 404 to an invite into an organisation that does not exist', async () => {
    const { ann, ask } = await harness()

    expect(
      await ask('POST', '/organisations/acme/members', {
        as: ann,
        body: { email: 'bob@example.test' },
      }),
    ).toEqual({ status: 404, body: { code: 'no-such-tenant' } })
  })

  it('answers 404 to an invite of an email no identity signs in with', async () => {
    const { ann, ask, founded } = await harness()

    await founded()

    expect(
      await ask('POST', '/organisations/acme/members', {
        as: ann,
        body: { email: 'dan@example.test' },
      }),
    ).toEqual({ status: 404, body: { code: 'no-such-identity' } })
  })

  it('answers 409 to an invite of an identity already in', async () => {
    const { ann, ask, founded, invited } = await harness()

    await founded()
    await invited()

    expect(
      await ask('POST', '/organisations/acme/members', {
        as: ann,
        body: { email: 'bob@example.test' },
      }),
    ).toEqual({ status: 409, body: { code: 'already-member' } })
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

  it('answers 401 to a request without an access token that signs an identity in, and does nothing', async () => {
    const { ann, ask } = await harness()

    for (const authorization of [
      undefined,
      `Basic ${btoa('ann@example.test:pass-word-1')}`,
      'Bearer',
      'Bearer not.an.access.token',
      // A refresh key is not taken in place of the access token it renews.
      `Bearer ${ann.tokens.refresh}`,
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
      await root.deviceSessions.revoke({
        identity: ann.identity.id,
        id: row?.id ?? expect.unreachable("Ann's device listed"),
      })
    )._unsafeUnwrap()

    // The access token still works, but the device it comes from is signed out.
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

    // Organisations over a directory that is gone: the identity still signs in on the root's.
    const routes = organisationRoutes(
      root.sessions,
      root.deviceSessions,
      new Organisations({
        directory,
        databases: root.databases,
        revoke: (identity, region) => root.connections.revoke(identity, region),
      }),
      routeOptions(new RequestLimits({ clock: manualClock() })),
    )

    expect(
      await answer(await routes(request('GET', '/organisations', { as: ann }), ADDRESS)),
    ).toEqual({ status: 500, body: { code: 'internal' } })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:QUERY_FAILED'])
  })

  it('answers 405 with the methods a path takes to any other method', async () => {
    const { ann, bob, routes } = await harness()

    for (const [method, path, allow] of [
      ['PUT', '/organisations', 'GET, POST'],
      ['DELETE', '/organisations', 'GET, POST'],
      ['DELETE', '/organisations/acme/members', 'GET, POST'],
      ['GET', `/organisations/acme/members/${bob.identity.id}`, 'DELETE'],
      ['POST', `/organisations/acme/members/${bob.identity.id}`, 'DELETE'],
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
      '/organisations/acme/people',
      '/organisationsx',
      '/auth/sign-in',
    ]) {
      expect(await routes(request('GET', path, { as: ann }), ADDRESS)).toBeUndefined()
    }
  })
})
