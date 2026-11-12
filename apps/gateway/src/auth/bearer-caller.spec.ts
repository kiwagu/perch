import { describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { device_sessionIdFactory, identityIdFactory } from '@workspace/ids'

import type { AuthSessions, SessionRead } from './auth-sessions'
import { bearerCaller, bearerRefused, bearerToken, DEVICE_HEADER } from './bearer-caller'

const IDENTITY = identityIdFactory.create()

/** The row of the laptop's session. */
const SESSION = device_sessionIdFactory.create()

/** A live session of the laptop. */
const LAPTOP: SessionRead = {
  kind: 'session',
  caller: {
    identity: IDENTITY,
    email: 'ann@example.test',
    device: 'laptop',
    session: SESSION,
    roles: ['operator'],
  },
}

/** Sessions whose every read answers `answer`, and the tokens they were asked to read. */
function sessionsAnswering(answer: SessionRead): {
  readonly sessions: Pick<AuthSessions, 'read'>
  readonly read: string[]
} {
  const read: string[] = []

  return {
    read,
    sessions: {
      read: (token) => {
        read.push(token)

        return Promise.resolve(answer)
      },
    },
  }
}

/** A call to the devices route with these headers. */
const call = (headers: Record<string, string>) =>
  new Request('http://localhost/devices', { headers })

describe('bearerToken', () => {
  it('reads the token of an Authorization header of the Bearer scheme, in any case', () => {
    expect(bearerToken(call({ Authorization: 'Bearer abc.def' }))).toBe('abc.def')
    expect(bearerToken(call({ Authorization: 'bearer  abc' }))).toBe('abc')
    expect(bearerToken(call({ Authorization: 'Basic abc' }))).toBeUndefined()
    expect(bearerToken(call({}))).toBeUndefined()
  })
})

describe('bearerCaller', () => {
  it('refuses a call that names no valid device before reading any session', async () => {
    const { sessions, read } = sessionsAnswering(LAPTOP)

    expect(await bearerCaller(sessions, call({ Authorization: 'Bearer token-1' }))).toEqual({
      kind: 'bad-request',
    })
    expect(
      await bearerCaller(
        sessions,
        call({ Authorization: 'Bearer token-1', [DEVICE_HEADER]: 'd'.repeat(65) }),
      ),
    ).toEqual({ kind: 'bad-request' })
    expect(read).toEqual([])
  })

  it('refuses a call without a session token before reading any session', async () => {
    const { sessions, read } = sessionsAnswering(LAPTOP)

    expect(await bearerCaller(sessions, call({ [DEVICE_HEADER]: 'laptop' }))).toEqual({
      kind: 'unauthorized',
    })
    expect(read).toEqual([])
  })

  it('refuses a token that reads no session', async () => {
    const { sessions, read } = sessionsAnswering({ kind: 'none' })

    expect(
      await bearerCaller(
        sessions,
        call({ Authorization: 'Bearer token-1', [DEVICE_HEADER]: 'laptop' }),
      ),
    ).toEqual({ kind: 'unauthorized' })
    expect(read).toEqual(['token-1'])
  })

  it('fails a call whose session could not be read', async () => {
    const error = dataError('data:QUERY_FAILED', 'the session could not be read')
    const { sessions } = sessionsAnswering({ kind: 'failed', error })

    expect(
      await bearerCaller(
        sessions,
        call({ Authorization: 'Bearer token-1', [DEVICE_HEADER]: 'laptop' }),
      ),
    ).toEqual({ kind: 'failed', error })
  })

  it('refuses a token whose session belongs to another device than the call names', async () => {
    const { sessions } = sessionsAnswering(LAPTOP)

    expect(
      await bearerCaller(
        sessions,
        call({ Authorization: 'Bearer token-1', [DEVICE_HEADER]: 'phone' }),
      ),
    ).toEqual({ kind: 'unauthorized' })
  })

  it('answers the identity, its email, the device, the session, its platform roles and the token of a session of the device', async () => {
    const { sessions } = sessionsAnswering(LAPTOP)

    expect(
      await bearerCaller(
        sessions,
        call({ Authorization: 'Bearer token-1', [DEVICE_HEADER]: 'laptop' }),
      ),
    ).toEqual({
      kind: 'caller',
      identity: IDENTITY,
      email: 'ann@example.test',
      device: 'laptop',
      session: SESSION,
      roles: ['operator'],
      token: 'token-1',
    })
  })
})

describe('bearerRefused', () => {
  it('answers 401 unauthorized, naming the Bearer scheme', async () => {
    const response = bearerRefused()

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(await response.json()).toEqual({ code: 'unauthorized' })
  })
})
