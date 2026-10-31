/**
 * The set-ups of the auth mount's specs: the mount over a stand-in for Better Auth, or over a real
 * instance on an embedded directory with the gateway's sessions, limits, sockets and turns; an
 * account with its verification link; a sign-up and a resend as the web sends them; a connection
 * that records its closes; and what a run prints.
 */

import { inspect } from 'node:util'

import { errAsync, okAsync } from 'neverthrow'
import { onTestFinished, vi } from 'vitest'

import { dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { KeyedTurns } from '../../../keyed-turns'
import { RequestLimits } from '../../../limits/request-limits'
import { linkToken, type Outbox } from '../../../mail/__fixtures__/outbox'
import { ConnectionRegistry, type MembershipsListener } from '../../../sync/connections'
import {
  AUTH_SECRET,
  deviceHeaders,
  type OpenAuthOptions,
  openAuth,
} from '../../__fixtures__/auth-instance'
import type { AuthInstance } from '../../auth-instance'
import { AuthSessions } from '../../auth-sessions'
import { type AuthMountDeps, authHandler } from '../mount'

/** The account most specs sign up and verify. */
export const ANN = 'ann@example.test'

/** The front's origin, which the browser names on every request. */
export const ORIGIN = 'http://localhost'

/** A close the mount asked the registry for: the identity, the device and the code. */
export type Close = readonly [IdentityId, string | undefined, number]

/**
 * A stand-in for Better Auth's handler: it keeps every request it is handed and answers each
 * with what `answer` makes of it.
 */
export function fakeAuth(answer: (request: Request) => Response) {
  const received: Request[] = []

  return {
    received,
    auth: {
      handler: async (request: Request) => {
        received.push(request)

        return answer(request)
      },
    },
  }
}

/**
 * A stand-in for the registry of sync connections: it keeps each close it is asked for, by
 * identity, device and code, and resolves each once `closing` does.
 */
export function fakeConnections(closing: Promise<void> = Promise.resolve()) {
  const closes: Close[] = []

  return {
    closes,
    connections: {
      close: (identity: IdentityId, device: string | undefined, code: number) => {
        closes.push([identity, device, code])

        return closing
      },
    },
  }
}

/**
 * A stand-in for the sessions a verification reads: no link names an email, no email has an
 * account, and no session is read back.
 */
export const noSessions: AuthMountDeps['sessions'] = {
  verificationEmail: async () => undefined,
  identityOf: () => okAsync(undefined),
  signedIn: () => errAsync(dataError('data:QUERY_FAILED', 'no session is read back here')),
}

/**
 * The mount over a stand-in answering `answer`, with real limits on a manual clock and a stand-in
 * registry whose closes resolve once `closing` does.
 */
export function mountedOnFakeAuth(answer: (request: Request) => Response, closing?: Promise<void>) {
  const clock = manualClock(1_000)
  const fake = fakeAuth(answer)
  const { closes, connections } = fakeConnections(closing)

  return {
    ...fake,
    clock,
    closes,
    route: authHandler({
      auth: fake.auth,
      sessions: noSessions,
      limits: new RequestLimits({ clock }),
      connections,
      clock,
      accounts: new KeyedTurns<string>(),
    }),
  }
}

/** What the failed readback of a session says: a token and an address, which nothing passes on. */
export const READBACK_FAILURE = 'MARKER the session of marker-ann@example.test tok_MARKER failed'

export interface RealMountOptions extends OpenAuthOptions {
  /** The readback of the session a verification signed in fails, with `READBACK_FAILURE`. */
  readonly readbackFails?: boolean
}

/** The instance each outbox the fixture opened belongs to. */
const INSTANCES = new WeakMap<Outbox, AuthInstance>()

/**
 * The mount over a real Better Auth instance on an embedded directory (closed when the test
 * finishes), with the gateway's sessions over it, a real registry of sync connections (`registry`)
 * whose every close the mount asks for is also kept (`closes`), real limits on the instance's
 * clock, and the accounts' turns.
 */
export async function mountedOnRealAuth(options: RealMountOptions = {}) {
  const opened = await openAuth(
    options.directory === undefined ? {} : { directory: options.directory },
  )

  onTestFinished(opened.close)
  INSTANCES.set(opened.outbox, opened.auth)

  const sessions = new AuthSessions({
    auth: opened.auth,
    directory: opened.local,
    clock: opened.clock,
    secret: AUTH_SECRET,
  })
  const failures: string[] = []
  const registry = new ConnectionRegistry({ onFailure: (error) => failures.push(error.code) })
  const closes: Close[] = []
  const route = authHandler({
    auth: opened.auth,
    sessions: {
      verificationEmail: (token) => sessions.verificationEmail(token),
      identityOf: (email) => sessions.identityOf(email),
      signedIn: (signed) =>
        options.readbackFails === true
          ? errAsync(dataError('data:QUERY_FAILED', READBACK_FAILURE))
          : sessions.signedIn(signed),
    },
    limits: new RequestLimits({ clock: opened.clock }),
    connections: {
      close: (identity, device, code) => {
        closes.push([identity, device, code])

        return registry.close(identity, device, code)
      },
    },
    clock: opened.clock,
    accounts: new KeyedTurns<string>(),
  })
  /** Ann's identity, once she signed up. */
  const annsId = async (): Promise<IdentityId> => {
    const identity = (await sessions.identityOf(ANN))._unsafeUnwrap()

    if (identity === undefined) {
      throw new Error('the account has not signed up')
    }

    return identity
  }

  return { ...opened, sessions, registry, failures, closes, route, annsId }
}

/**
 * Signs `email` up (Ann, on `laptop`), which signs nothing in and mails the account its link, and
 * answers the token of that link: the account stays unverified until a test opens it.
 */
export async function annsLink(outbox: Outbox, email = ANN): Promise<string> {
  const auth = INSTANCES.get(outbox)

  if (auth === undefined) {
    throw new Error('the outbox is not of a mount the fixture opened')
  }

  const seen = outbox.to(email).length

  await auth.api.signUpEmail({
    body: { name: 'Ann', email, password: 'pass-word-1', locale: 'en' },
    headers: deviceHeaders('laptop'),
  })

  return linkToken(await outbox.next(email, seen))
}

/** A sign-up of `email`, as the web sends it from the front's origin. */
export function signUpRequest(email: string): Request {
  return new Request('http://gateway.test/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ name: 'Ann', email, password: 'pass-word-1', locale: 'en' }),
  })
}

/** A resend of the verification mail to `email`, as the web sends it from the front's origin. */
export function resendRequest(email: string): Request {
  return new Request('http://gateway.test/auth/send-verification-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email }),
  })
}

/** A sync connection that records the codes it is closed with. */
export function fakeConnection(): MembershipsListener & { readonly ended: number[] } {
  const ended: number[] = []

  return {
    ended,
    memberships: () => Promise.resolve(),
    revoke: () => Promise.resolve(),
    end: (code) => {
      ended.push(code)

      return Promise.resolve()
    },
    supersede: () => undefined,
  }
}

/**
 * What `run` resolves to, and everything printed meanwhile to the console or to the process's
 * output streams, as text: the printing itself is held back.
 */
export async function printedDuring<T>(
  run: () => Promise<T>,
): Promise<{ result: T; printed: string }> {
  const chunks: string[] = []
  const keep = (...args: unknown[]): void => {
    chunks.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' '))
  }
  const write = (chunk: string | Uint8Array): boolean => {
    keep(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))

    return true
  }
  const spies = [
    vi.spyOn(console, 'error').mockImplementation(keep),
    vi.spyOn(console, 'warn').mockImplementation(keep),
    vi.spyOn(console, 'log').mockImplementation(keep),
    vi.spyOn(console, 'info').mockImplementation(keep),
    vi.spyOn(console, 'debug').mockImplementation(keep),
    vi.spyOn(process.stderr, 'write').mockImplementation(write),
    vi.spyOn(process.stdout, 'write').mockImplementation(write),
  ]

  try {
    return { result: await run(), printed: chunks.join('\n') }
  } finally {
    for (const spy of spies) {
      spy.mockRestore()
    }
  }
}
