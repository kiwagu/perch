import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createAuth, type DataError, type LocalDb } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import { IdentitySessions } from './identity-sessions'

const RPC_URL = 'http://127.0.0.1:8000/rpc'

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

interface FetchCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A `fetch` that records each request and answers it with `answer`. */
function fakeFetch(answer: () => Promise<Response>): {
  readonly fetch: typeof fetch
  readonly calls: readonly FetchCall[]
} {
  const calls: FetchCall[] = []
  const call = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init })

    return answer()
  }

  return { fetch: Object.assign(call, { preconnect: () => {} }), calls }
}

const unreachable = fakeFetch(() => Promise.reject(new TypeError('no network in this test')))

const opened: LocalDb[] = []

/** Failures to close an auth session that no test expected. */
const closeFailures: DataError[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.close()))

  expect(closeFailures.splice(0)).toEqual([])
})

async function testDb(schema = readSchema('directory')): Promise<LocalDb> {
  const local = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema })
  )._unsafeUnwrap()

  opened.push(local)

  return local
}

/** Sessions over `local`, opening auth sessions as the composition root does. */
function sessionsOver(
  local: LocalDb,
  options: {
    readonly fetch?: typeof fetch
    readonly onCloseFailure?: (error: DataError) => void
  } = {},
): IdentitySessions {
  return new IdentitySessions({
    openAuth: () =>
      createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
    rpcUrl: RPC_URL,
    fetch: options.fetch ?? unreachable.fetch,
    onCloseFailure: options.onCloseFailure ?? ((error) => closeFailures.push(error)),
  })
}

async function testSessions(http: typeof fetch = unreachable.fetch): Promise<IdentitySessions> {
  return sessionsOver(await testDb(), { fetch: http })
}

/** Sessions over a database that counts the driver sessions opened and closed on it. */
async function countingSessions() {
  const local = await testDb()
  const newSession = local.db.newSession.bind(local.db)
  let opened = 0
  let closed = 0

  local.db.newSession = async () => {
    const session = await newSession()
    const closeSession = session.closeSession.bind(session)

    opened += 1
    session.closeSession = async () => {
      closed += 1
      await closeSession()
    }

    return session
  }

  return {
    sessions: sessionsOver(local),
    opened: () => opened,
    closed: () => closed,
  }
}

/** Makes closing every driver session opened on `local` from now on fail once it has closed. */
function failClosing(local: LocalDb): void {
  const newSession = local.db.newSession.bind(local.db)

  local.db.newSession = async () => {
    const session = await newSession()
    const closeSession = session.closeSession.bind(session)

    session.closeSession = async () => {
      await closeSession()

      throw new Error('the connection to the database dropped')
    }

    return session
  }
}

describe('IdentitySessions', () => {
  it('signs an identity up and in, and the tokens authenticate it', async () => {
    const sessions = await testSessions()

    const up = (
      await sessions.signUp({ email: 'ann@example.test', password: 'pass-word-1' })
    )._unsafeUnwrap()
    const again = (
      await sessions.signIn({ email: 'ann@example.test', password: 'pass-word-1' })
    )._unsafeUnwrap()
    const device = (await sessions.authenticate(again.tokens))._unsafeUnwrap()

    expect(up.identity.id).toMatch(/^idn_/)
    expect(up.identity).toEqual({ id: up.identity.id, email: ann.email })
    expect(up.tokens.refresh).toMatch(/\S/)
    expect(device.identity.id).toBe(up.identity.id)
    expect(device.renewed).toBe(false)
    expect(device.tokens).toEqual(again.tokens)
  })

  it('renews the pair with the refresh key when the access token is not accepted', async () => {
    const sessions = await testSessions()
    const { identity, tokens } = (await sessions.signUp(ann))._unsafeUnwrap()

    const device = (
      await sessions.authenticate({ access: 'expired.or.garbage', refresh: tokens.refresh })
    )._unsafeUnwrap()

    expect(device.renewed).toBe(true)
    expect(device.identity).toEqual(identity)
    expect(device.tokens.access).toMatch(/^ey/)
    expect(device.tokens.refresh).toMatch(/\S/)
    expect(device.tokens.refresh).not.toBe(tokens.refresh)
    // The key it replaced is spent.
    expect(
      (
        await sessions.authenticate({ access: 'expired.or.garbage', refresh: tokens.refresh })
      )._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('refuses wrong credentials and an unknown refresh key', async () => {
    const sessions = await testSessions()

    expect((await sessions.signUp(ann)).isOk()).toBe(true)

    expect((await sessions.signIn({ ...ann, password: 'wrong' }))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CREDENTIALS',
    )
    expect(
      (await sessions.authenticate({ access: 'x', refresh: 'surreal-refresh-unknown' })).isErr(),
    ).toBe(true)
    expect(
      (
        await sessions.authenticate({ access: 'x', refresh: 'surreal-refresh-unknown' })
      )._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('refuses an access token that is not accepted when no refresh key comes with it', async () => {
    const sessions = await testSessions()

    expect((await sessions.authenticate({ access: 'x' }))._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
  })

  it('refuses a second sign-up with the same email', async () => {
    const sessions = await testSessions()

    expect((await sessions.signUp(ann)).isOk()).toBe(true)
    expect((await sessions.signUp(ann))._unsafeUnwrapErr().code).toBe('data:SIGN_UP_REJECTED')
  })

  it('fails a sign-in whose reply carries no refresh key instead of answering without one', async () => {
    const withoutRefresh = readFileSync(
      new URL('./__fixtures__/identity-without-refresh.surql', import.meta.url),
      'utf8',
    )
    const sessions = sessionsOver(await testDb(`${readSchema('directory')}\n${withoutRefresh}`))

    expect((await sessions.signUp(ann))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect((await sessions.signIn(ann))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('keeps the result of a call whose database session fails to close, and reports the failure', async () => {
    const local = await testDb()
    const failures: DataError[] = []
    const sessions = sessionsOver(local, { onCloseFailure: (error) => failures.push(error) })

    failClosing(local)

    // The identity exists once the sign-up answered, so its pair must reach the device.
    const { identity, tokens } = (await sessions.signUp(ann))._unsafeUnwrap()
    // The renewal spent the old key, so the new pair must reach the device too.
    const device = (
      await sessions.authenticate({ access: 'expired.or.garbage', refresh: tokens.refresh })
    )._unsafeUnwrap()
    const renewed = device.renewed ? device.tokens : expect.unreachable('a renewed pair')
    const again = await sessions.authenticate({
      access: 'expired.or.garbage',
      refresh: renewed.refresh,
    })

    expect(device.identity).toEqual(identity)
    expect(renewed.refresh).not.toBe(tokens.refresh)
    expect(again._unsafeUnwrap().identity).toEqual(identity)
    expect(failures.map((failure) => [failure.code, failure.message])).toEqual(
      Array.from({ length: 3 }, () => ['data:AUTH_FAILED', 'the auth session could not be closed']),
    )
  })

  it('closes the database session of every call', async () => {
    const { sessions, opened, closed } = await countingSessions()

    expect((await sessions.signUp(ann)).isOk()).toBe(true)
    expect((await sessions.signIn(ann)).isOk()).toBe(true)
    expect((await sessions.signIn({ ...ann, password: 'wrong' })).isErr()).toBe(true)
    expect(
      (await sessions.authenticate({ access: 'x', refresh: 'surreal-refresh-x' })).isErr(),
    ).toBe(true)

    expect(opened()).toBe(4)
    expect(closed()).toBe(opened())
  })
})

describe('IdentitySessions.revoke', () => {
  const tokens = { access: 'device-access-token', refresh: 'surreal-refresh-device-key' }

  it("posts the database's RPC revoke with the device's pair", async () => {
    const http = fakeFetch(() => Promise.resolve(Response.json({ id: 1, result: null })))
    const sessions = await testSessions(http.fetch)

    expect((await sessions.revoke(tokens)).isOk()).toBe(true)

    const [call, ...more] = http.calls
    const headers = new Headers(call?.init?.headers)
    const body: unknown = JSON.parse(String(call?.init?.body))

    expect(more).toEqual([])
    expect(call?.url).toBe(RPC_URL)
    expect(call?.init?.method).toBe('POST')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
    expect(body).toEqual({ id: 1, method: 'revoke', params: [tokens] })
  })

  it('fails when the database answers the call with an error', async () => {
    const http = fakeFetch(() =>
      Promise.resolve(
        Response.json({ id: 1, error: { code: -32000, message: 'There was a problem' } }),
      ),
    )
    const sessions = await testSessions(http.fetch)

    expect((await sessions.revoke(tokens))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('fails when the endpoint answers with a failure status', async () => {
    const http = fakeFetch(() => Promise.resolve(new Response('unavailable', { status: 503 })))
    const sessions = await testSessions(http.fetch)

    expect((await sessions.revoke(tokens))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('fails when the endpoint cannot be reached', async () => {
    const sessions = await testSessions(unreachable.fetch)

    expect((await sessions.revoke(tokens))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })
})
