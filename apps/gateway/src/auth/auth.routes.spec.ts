import { err, errAsync, okAsync, type Result, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError, type SignInInput, type SignUpInput } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { TEST_SIGNING_KEY } from '@workspace/data/testing'
import { identityIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { createGatewayRoot, type GatewayRoot } from '../composition/root'
import { RequestLimits } from '../limits/request-limits'
import type { Organisations } from '../tenants/organisations'

import { authRoutes } from './auth.routes'
import type { IdentitySessions, SignedIn, SignInDevice } from './identity-sessions'

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

/** The device Ann signs in on. */
const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

/** Ann's credentials as her laptop sends them. */
const annOnLaptop = { ...ann, device: laptop }

const signedIn: SignedIn = {
  identity: { id: identityIdFactory.create(), email: ann.email },
  tokens: { access: 'access-token', refresh: 'surreal-refresh-key' },
}

/** The sign-in service as the routes see it: Ann exists, with her password. */
function stubSessions(): Pick<IdentitySessions, 'signUp' | 'signIn'> & {
  readonly calls: Array<readonly [SignUpInput | SignInInput, SignInDevice]>
} {
  const calls: Array<readonly [SignUpInput | SignInInput, SignInDevice]> = []

  return {
    calls,
    signUp: (input, device) => {
      calls.push([input, device])

      return input.email === ann.email
        ? errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
        : okAsync({ ...signedIn, identity: { ...signedIn.identity, email: input.email } })
    },
    signIn: (input, device) => {
      calls.push([input, device])

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

/** The address Ann's requests come from, as the server reads it. */
const annsAddress = '203.0.113.7'

/**
 * The routes over `sessions` with limits of their own on a manual clock: `ask` sends a request
 * from an address, Ann's by default.
 */
function limitedRoutes(
  sessions: Pick<IdentitySessions, 'signUp' | 'signIn'>,
  organisations: Pick<Organisations, 'membershipsOf'> = noMemberships,
) {
  const clock = manualClock(1_000)
  const routes = authRoutes(sessions, organisations, new RequestLimits({ clock }))

  return {
    clock,
    ask: (request: Request, from: string = annsAddress) => routes(request, from),
  }
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
      clock: manualClock(),
      signingKey: TEST_SIGNING_KEY,
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
  it('signs an identity up on its device and answers with the identity and its tokens', async () => {
    const sessions = stubSessions()
    const { ask } = limitedRoutes(sessions, noMemberships)
    const bob = { email: 'bob@example.test', password: 'pass-word-2' }

    expect(await answer(await ask(post('/auth/sign-up', { ...bob, device: laptop })))).toEqual({
      status: 200,
      body: {
        identity: { id: signedIn.identity.id, email: bob.email },
        tokens: signedIn.tokens,
        memberships: [],
      },
    })
    expect(sessions.calls).toEqual([[bob, laptop]])
  })

  it('signs an identity in on its device', async () => {
    const sessions = stubSessions()
    const { ask } = limitedRoutes(sessions, noMemberships)

    expect(await answer(await ask(post('/auth/sign-in', annOnLaptop)))).toEqual({
      status: 200,
      body: { identity: signedIn.identity, tokens: signedIn.tokens, memberships: [] },
    })
    expect(sessions.calls).toEqual([[ann, laptop]])
  })

  it('answers 409 to a sign-up with an email that is taken', async () => {
    const { ask } = limitedRoutes(stubSessions(), noMemberships)

    expect(await answer(await ask(post('/auth/sign-up', annOnLaptop)))).toEqual({
      status: 409,
      body: { code: 'sign-up-rejected' },
    })
  })

  it('answers 401 to a wrong password', async () => {
    const { ask } = limitedRoutes(stubSessions(), noMemberships)

    expect(
      await answer(
        await ask(post('/auth/sign-in', { ...annOnLaptop, password: 'wrong-password' })),
      ),
    ).toEqual({ status: 401, body: { code: 'invalid-credentials' } })
  })

  it('answers 400 to a body that does not follow the schema, without calling the service', async () => {
    const sessions = stubSessions()
    const { ask } = limitedRoutes(sessions, noMemberships)

    for (const body of [
      { email: 'not-an-email', password: 'pass-word-1', device: laptop },
      { email: ann.email, password: 'short', device: laptop },
      { email: ann.email, password: 'x'.repeat(201), device: laptop },
      { email: ann.email, device: laptop },
      ann,
      { ...ann, device: { label: laptop.label } },
      { ...ann, device: { id: '', label: laptop.label } },
      { ...ann, device: { id: 'd'.repeat(65), label: laptop.label } },
      { ...ann, device: { id: laptop.id, label: 'l'.repeat(61) } },
      '{"email":',
    ]) {
      expect(await answer(await ask(post('/auth/sign-in', body)))).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }

    expect(sessions.calls).toEqual([])
  })

  it("answers 500 to a failure that is not the caller's fault", async () => {
    const { ask } = limitedRoutes(
      {
        ...stubSessions(),
        signIn: () =>
          errAsync(dataError('data:AUTH_FAILED', 'the sign-in returned no refresh key')),
      },
      noMemberships,
    )

    expect(await answer(await ask(post('/auth/sign-in', annOnLaptop)))).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
  })

  it('answers 500 when the memberships of the identity cannot be read', async () => {
    const { ask } = limitedRoutes(stubSessions(), {
      membershipsOf: () => errAsync(dataError('data:QUERY_FAILED', 'the directory is gone')),
    })

    expect(await answer(await ask(post('/auth/sign-in', annOnLaptop)))).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
  })

  it('answers 405 to a method other than POST', async () => {
    const { ask } = limitedRoutes(stubSessions(), noMemberships)
    const response = await ask(new Request('http://gateway.test/auth/sign-in'))

    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toBe('POST')
  })

  it('leaves a path that is not its own to the caller', async () => {
    const { ask } = limitedRoutes(stubSessions(), noMemberships)

    expect(await ask(post('/auth/sign-out', ann))).toBeUndefined()
    expect(await ask(post('/health', ann))).toBeUndefined()
  })
})

/** Ann's credentials from her laptop with a password that is not hers. */
const wrongPassword = { ...annOnLaptop, password: 'wrong-password' }

/** An address of its own for the attempt numbered `n`. */
const addressOf = (n: number): string => `198.51.100.${n + 1}`

const rateLimited = { status: 429, body: { code: 'rate-limited' } }

describe('authRoutes limits', () => {
  it('lets 20 sign-ins of one address within 10 s reach the service and answers the 21st 429 with Retry-After', async () => {
    const sessions = stubSessions()
    const { clock, ask } = limitedRoutes(sessions)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await ask(post('/auth/sign-in', annOnLaptop)))?.status).toBe(200)
    }

    await clock.advance(3_000)

    const refused = await ask(post('/auth/sign-in', annOnLaptop))

    expect(refused?.headers.get('Retry-After')).toBe('7')
    expect(await answer(refused)).toEqual(rateLimited)
    expect(sessions.calls).toHaveLength(20)
    expect((await ask(post('/auth/sign-in', annOnLaptop), '203.0.113.8'))?.status).toBe(200)
    await clock.advance(7_000)
    expect((await ask(post('/auth/sign-in', annOnLaptop)))?.status).toBe(200)
  })

  it('counts the sign-ups and the sign-ins of one address together', async () => {
    const sessions = stubSessions()
    const { ask } = limitedRoutes(sessions)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const bob = { ...annOnLaptop, email: `bob-${attempt}@example.test` }

      expect((await ask(post('/auth/sign-up', bob)))?.status).toBe(200)
      expect((await ask(post('/auth/sign-in', annOnLaptop)))?.status).toBe(200)
    }

    expect(
      await answer(await ask(post('/auth/sign-up', { ...annOnLaptop, email: 'cy@example.test' }))),
    ).toEqual(rateLimited)
    expect(await answer(await ask(post('/auth/sign-in', annOnLaptop)))).toEqual(rateLimited)
    expect(sessions.calls).toHaveLength(20)
  })

  it('counts nothing for a body that does not follow the schema', async () => {
    const sessions = stubSessions()
    const { ask } = limitedRoutes(sessions)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const body = { ...annOnLaptop, email: 'not-an-email' }

      expect((await ask(post('/auth/sign-in', body)))?.status).toBe(400)
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await ask(post('/auth/sign-in', annOnLaptop)))?.status).toBe(200)
    }
  })

  it('answers 400 to an email of more than 254 characters and counts nothing for it', async () => {
    const sessions = stubSessions()
    const { ask } = limitedRoutes(sessions)
    const domain = '@example.test'
    /** An email of `length` characters of its own for the attempt numbered `n`. */
    const emailOf = (n: number, length: number) =>
      `${String(n).padStart(length - domain.length, 'b')}${domain}`

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const email = emailOf(attempt, 255)

      expect(await answer(await ask(post('/auth/sign-in', { ...wrongPassword, email })))).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
      expect(await answer(await ask(post('/auth/sign-up', { ...annOnLaptop, email })))).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
    }

    expect(sessions.calls).toEqual([])

    for (let attempt = 0; attempt < 19; attempt += 1) {
      expect((await ask(post('/auth/sign-in', annOnLaptop)))?.status).toBe(200)
    }

    // The longest email an address can have is taken as any other.
    const longest = { ...wrongPassword, email: emailOf(0, 254) }

    expect((await ask(post('/auth/sign-in', longest)))?.status).toBe(401)
  })

  it('refuses a sign-in of an email after 10 wrong passwords from any addresses, whatever its case, without asking the service', async () => {
    const sessions = stubSessions()
    const { clock, ask } = limitedRoutes(sessions)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const email = attempt % 2 === 0 ? ann.email : 'ANN@example.test'

      expect(
        (await ask(post('/auth/sign-in', { ...wrongPassword, email }), addressOf(attempt)))?.status,
      ).toBe(401)
    }

    const refused = await ask(post('/auth/sign-in', annOnLaptop), addressOf(10))

    expect(refused?.headers.get('Retry-After')).toBe(String(15 * 60))
    expect(await answer(refused)).toEqual(rateLimited)
    expect(
      await answer(
        await ask(
          post('/auth/sign-in', { ...annOnLaptop, email: 'ANN@example.test' }),
          addressOf(11),
        ),
      ),
    ).toEqual(rateLimited)
    expect(sessions.calls).toHaveLength(10)
    await clock.advance(15 * 60_000)
    expect((await ask(post('/auth/sign-in', annOnLaptop), addressOf(12)))?.status).toBe(200)
  })

  it("clears an email's failures when it signs in", async () => {
    const { ask } = limitedRoutes(stubSessions())

    for (let round = 0; round < 2; round += 1) {
      for (let attempt = 0; attempt < 9; attempt += 1) {
        expect(
          (await ask(post('/auth/sign-in', wrongPassword), addressOf(round * 10 + attempt)))
            ?.status,
        ).toBe(401)
      }

      expect(
        (await ask(post('/auth/sign-in', annOnLaptop), addressOf(round * 10 + 9)))?.status,
      ).toBe(200)
    }
  })

  it('counts no failure of the email for a sign-in the database could not judge', async () => {
    const stub = stubSessions()
    let reachable = false
    const { ask } = limitedRoutes({
      ...stub,
      signIn: (input, device) =>
        reachable
          ? stub.signIn(input, device)
          : errAsync(dataError('data:QUERY_FAILED', 'the directory is gone')),
    })

    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(
        await answer(await ask(post('/auth/sign-in', wrongPassword), addressOf(attempt))),
      ).toEqual({ status: 500, body: { code: 'internal' } })
    }

    reachable = true

    expect((await ask(post('/auth/sign-in', annOnLaptop), addressOf(12)))?.status).toBe(200)
  })
})

/**
 * The sign-in service held: every sign-in reaches it at once (counted in `arrived`) and is
 * answered by `answer` only once `release` is called.
 */
function heldSignIns(answer: () => Promise<Result<SignedIn, DataError>>) {
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const state = { arrived: 0 }
  const sessions: Pick<IdentitySessions, 'signUp' | 'signIn'> = {
    ...stubSessions(),
    signIn: () => {
      state.arrived += 1

      return new ResultAsync(held.then(answer))
    },
  }

  return { sessions, state, release: () => release() }
}

describe('authRoutes limits on sign-ins under way', () => {
  /**
   * Sends `count` sign-ins from addresses of their own at once and waits until each either
   * reached the held service or was refused; answers their statuses once they are released.
   */
  async function sendHeld(
    held: ReturnType<typeof heldSignIns>,
    ask: ReturnType<typeof limitedRoutes>['ask'],
    count: number,
    credentials: typeof annOnLaptop,
  ): Promise<Array<number | undefined>> {
    let refused = 0
    const answers = Array.from({ length: count }, (_, attempt) =>
      ask(post('/auth/sign-in', credentials), addressOf(attempt)).then((response) => {
        refused += response?.status === 429 ? 1 : 0

        return response?.status
      }),
    )

    await vi.waitFor(() => expect(held.state.arrived + refused).toBe(count))
    held.release()

    return Promise.all(answers)
  }

  it('counts the sign-ins of an email still under way: of 15 parallel wrong passwords, 10 reach the service', async () => {
    const held = heldSignIns(() =>
      Promise.resolve(err(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))),
    )
    const { ask } = limitedRoutes(held.sessions)
    const statuses = await sendHeld(held, ask, 15, wrongPassword)

    expect(held.state.arrived).toBe(10)
    expect(statuses.filter((status) => status === 401)).toHaveLength(10)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5)
  })

  it('gives the places of sign-ins the database could not judge back to the email', async () => {
    const held = heldSignIns(() =>
      Promise.resolve(err(dataError('data:QUERY_FAILED', 'the directory is gone'))),
    )
    const { ask } = limitedRoutes(held.sessions)
    const statuses = await sendHeld(held, ask, 11, annOnLaptop)

    // While 10 were under way, the 11th was refused; once judged by nobody, they count nothing.
    expect(held.state.arrived).toBe(10)
    expect(statuses.filter((status) => status === 500)).toHaveLength(10)
    expect(statuses.filter((status) => status === 429)).toHaveLength(1)
    expect((await sendHeld(held, ask, 10, annOnLaptop)).every((status) => status === 500)).toBe(
      true,
    )
    expect(held.state.arrived).toBe(20)
  })
})

describe('authRoutes over the organisations of the gateway', () => {
  it('answers a sign-up and a sign-in with no memberships while the identity belongs nowhere', async () => {
    const root = await openRoot()
    const { ask } = limitedRoutes(root.sessions, root.organisations)
    const up = await answer(await ask(post('/auth/sign-up', annOnLaptop)))
    const again = await answer(await ask(post('/auth/sign-in', annOnLaptop)))

    expect(up).toMatchObject({ status: 200, body: { memberships: [] } })
    expect(again).toMatchObject({ status: 200, body: { memberships: [] } })
  })

  it('answers 500, never 401 or 409, to a sign-up and a sign-in the database could not judge', async () => {
    const root = await openRoot()
    const { ask } = limitedRoutes(root.sessions, root.organisations)

    expect((await answer(await ask(post('/auth/sign-up', annOnLaptop)))).status).toBe(200)

    root.local.db.newSession = () => Promise.reject(new Error('the database cannot be reached'))

    const up = await answer(
      await ask(post('/auth/sign-up', { ...annOnLaptop, email: 'bob@example.test' })),
    )
    const again = await answer(await ask(post('/auth/sign-in', annOnLaptop)))

    expect([up, again]).toEqual([
      { status: 500, body: { code: 'internal' } },
      { status: 500, body: { code: 'internal' } },
    ])
  })

  it('answers a sign-in with the membership of the organisation the identity created', async () => {
    const root = await openRoot()
    const { ask } = limitedRoutes(root.sessions, root.organisations)
    const { identity } = (await root.sessions.signUp(ann, laptop))._unsafeUnwrap()
    const acme = (
      await root.organisations.create({ identity: identity.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()
    const { status, body } = await answer(await ask(post('/auth/sign-in', annOnLaptop)))

    expect(status).toBe(200)
    expect(body).toMatchObject({ identity, memberships: [acme] })
  })
})
