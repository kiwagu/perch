import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { dataError, type SignInInput, type SignUpInput } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { identityIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { createGatewayRoot, type GatewayRoot } from '../composition/root'
import type { Organisations } from '../tenants/organisations'

import { authRoutes } from './auth.routes'
import type { IdentitySessions, SignedIn } from './identity-sessions'

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

const signedIn: SignedIn = {
  identity: { id: identityIdFactory.create(), email: ann.email },
  tokens: { access: 'access-token', refresh: 'surreal-refresh-key' },
}

/** The sign-in service as the routes see it: Ann exists, with her password. */
function stubSessions(): Pick<IdentitySessions, 'signUp' | 'signIn'> & {
  readonly calls: Array<SignUpInput | SignInInput>
} {
  const calls: Array<SignUpInput | SignInInput> = []

  return {
    calls,
    signUp: (input) => {
      calls.push(input)

      return input.email === ann.email
        ? errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
        : okAsync({ ...signedIn, identity: { ...signedIn.identity, email: input.email } })
    },
    signIn: (input) => {
      calls.push(input)

      return input.email === ann.email && input.password === ann.password
        ? okAsync(signedIn)
        : errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))
    },
  }
}

/** The organisations as the routes see them: nobody belongs to any. */
const noMemberships: Pick<Organisations, 'membershipsOf'> = {
  membershipsOf: () => okAsync([]),
}

/** The gateways the tests opened, closed after each. */
const opened: GatewayRoot[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((root) => root.close()))
})

/** A gateway on embedded databases: the directory, and one per organisation. */
async function openRoot(): Promise<GatewayRoot> {
  const root = (
    await createGatewayRoot({
      engines: nodeEngines(),
      url: 'mem://',
      rpcUrl: 'http://127.0.0.1:8000/rpc',
      clock: manualClock(),
    })
  )._unsafeUnwrap()

  opened.push(root)

  return root
}

const post = (path: string, body: unknown): Request =>
  new Request(`http://gateway.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

async function answer(response: Response | undefined): Promise<{ status: number; body: unknown }> {
  if (!response) {
    return expect.unreachable('the route answered nothing')
  }

  const body: unknown = await response.json()

  return { status: response.status, body }
}

describe('authRoutes', () => {
  it('signs an identity up and answers with the identity and its tokens', async () => {
    const routes = authRoutes(stubSessions(), noMemberships)
    const bob = { email: 'bob@example.test', password: 'pass-word-2' }

    expect(await answer(await routes(post('/auth/sign-up', bob)))).toEqual({
      status: 200,
      body: {
        identity: { id: signedIn.identity.id, email: bob.email },
        tokens: signedIn.tokens,
        memberships: [],
      },
    })
  })

  it('signs an identity in', async () => {
    const routes = authRoutes(stubSessions(), noMemberships)

    expect(await answer(await routes(post('/auth/sign-in', ann)))).toEqual({
      status: 200,
      body: { identity: signedIn.identity, tokens: signedIn.tokens, memberships: [] },
    })
  })

  it('answers 409 to a sign-up with an email that is taken', async () => {
    const routes = authRoutes(stubSessions(), noMemberships)

    expect(await answer(await routes(post('/auth/sign-up', ann)))).toEqual({
      status: 409,
      body: { code: 'sign-up-rejected' },
    })
  })

  it('answers 401 to a wrong password', async () => {
    const routes = authRoutes(stubSessions(), noMemberships)

    expect(
      await answer(await routes(post('/auth/sign-in', { ...ann, password: 'wrong-password' }))),
    ).toEqual({ status: 401, body: { code: 'invalid-credentials' } })
  })

  it('answers 400 to a body that does not follow the schema, without calling the service', async () => {
    const sessions = stubSessions()
    const routes = authRoutes(sessions, noMemberships)

    for (const body of [
      { email: 'not-an-email', password: 'pass-word-1' },
      { email: ann.email, password: 'short' },
      { email: ann.email, password: 'x'.repeat(201) },
      { email: ann.email },
      '{"email":',
    ]) {
      expect(await answer(await routes(post('/auth/sign-in', body)))).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }

    expect(sessions.calls).toEqual([])
  })

  it("answers 500 to a failure that is not the caller's fault", async () => {
    const routes = authRoutes(
      {
        ...stubSessions(),
        signIn: () =>
          errAsync(dataError('data:AUTH_FAILED', 'the sign-in returned no refresh key')),
      },
      noMemberships,
    )

    expect(await answer(await routes(post('/auth/sign-in', ann)))).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
  })

  it('answers 500 when the memberships of the identity cannot be read', async () => {
    const routes = authRoutes(stubSessions(), {
      membershipsOf: () => errAsync(dataError('data:QUERY_FAILED', 'the directory is gone')),
    })

    expect(await answer(await routes(post('/auth/sign-in', ann)))).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
  })

  it('answers 405 to a method other than POST', async () => {
    const routes = authRoutes(stubSessions(), noMemberships)
    const response = await routes(new Request('http://gateway.test/auth/sign-in'))

    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toBe('POST')
  })

  it('leaves a path that is not its own to the caller', async () => {
    const routes = authRoutes(stubSessions(), noMemberships)

    expect(await routes(post('/auth/sign-out', ann))).toBeUndefined()
    expect(await routes(post('/health', ann))).toBeUndefined()
  })
})

describe('authRoutes over the organisations of the gateway', () => {
  it('answers a sign-up and a sign-in with no memberships while the identity belongs nowhere', async () => {
    const root = await openRoot()
    const routes = authRoutes(root.sessions, root.organisations)
    const up = await answer(await routes(post('/auth/sign-up', ann)))
    const again = await answer(await routes(post('/auth/sign-in', ann)))

    expect(up).toMatchObject({ status: 200, body: { memberships: [] } })
    expect(again).toMatchObject({ status: 200, body: { memberships: [] } })
  })

  it('answers a sign-in with the membership of the organisation the identity created', async () => {
    const root = await openRoot()
    const routes = authRoutes(root.sessions, root.organisations)
    const { identity } = (await root.sessions.signUp(ann))._unsafeUnwrap()
    const acme = (
      await root.organisations.create({ identity: identity.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()
    const { status, body } = await answer(await routes(post('/auth/sign-in', ann)))

    expect(status).toBe(200)
    expect(body).toMatchObject({ identity, memberships: [acme] })
  })
})
