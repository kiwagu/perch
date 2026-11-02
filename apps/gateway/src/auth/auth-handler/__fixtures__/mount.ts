/**
 * The set-ups of the auth mount's specs: the mount over a stand-in for Better Auth, or over a real
 * instance on an embedded directory with the gateway's sessions, limits, sockets and turns; an
 * account with its verification link; a sign-up and a resend as the web sends them; a connection
 * that records its closes; and what a run prints.
 */

import { inspect } from 'node:util'

import { errAsync, okAsync } from 'neverthrow'
import { expect, onTestFinished, vi } from 'vitest'

import { dataError, type LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { type IdentityId, identityIdFactory, idSchemas } from '@workspace/ids'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { KeyedTurns } from '../../../keyed-turns'
import { RequestLimits } from '../../../limits/request-limits'
import { linkToken, type Outbox } from '../../../mail/__fixtures__/outbox'
import { ConnectionRegistry, type MembershipsListener } from '../../../sync/connections'
import {
  AUTH_SECRET,
  accountServicesOf,
  deviceHeaders,
  type OpenAuthOptions,
  openAuth,
  signUpOn,
} from '../../__fixtures__/auth-instance'
import type { AuthInstance } from '../../auth-instance'
import { AuthSessions } from '../../auth-sessions'
import { type AuthMountDeps, authHandler } from '../mount'

/** The account most specs sign up and verify. */
export const ANN = 'ann@example.test'

/** The password most specs sign up with, which keeps the rules of a new password. */
export const PASSWORD = 'Pass-word-1'

/** The front's origin, which the browser names on every request. */
export const ORIGIN = 'http://localhost'

/** A close the mount asked the registry for: the identity, the device and the code. */
export type Close = readonly [IdentityId, string | undefined, number]

/**
 * A stand-in for Better Auth's handler: it keeps every request it is handed and answers each
 * with what `answer` makes of it, once that settles.
 */
export function fakeAuth(answer: (request: Request) => Response | Promise<Response>) {
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
 * The account every email signs in to over a stand-in for Better Auth: the gateway's reads of an
 * email's credential find it, with one password, before and after the stand-in answers.
 */
export const STAND_IN_ACCOUNT = identityIdFactory.create()

/** An accepted sign-in of the stand-in's account, as Better Auth answers one. */
export const signedInAnswer = (): Response =>
  Response.json({ token: 'raw-token', user: { id: STAND_IN_ACCOUNT } })

/** What a stand-in that is not meant to be asked fails with. */
const notHere = () => errAsync(dataError('data:QUERY_FAILED', 'nothing is read here'))

/** The email every verification link names over a stand-in for Better Auth. */
export const STAND_IN_EMAIL = 'stand-in@example.test'

/**
 * A stand-in for the sessions a verification reads: every token reads as the link of a mail to
 * the stand-in's account (`STAND_IN_ACCOUNT`, which the stand-in's credential reads find holding
 * any email), the token itself being Better Auth's, naming `STAND_IN_EMAIL`; no email has an
 * account, no session is read back, no token holds a session, and nothing is signed out.
 */
export const noSessions: AuthMountDeps['sessions'] = {
  verificationOf: async (token) => ({
    identity: STAND_IN_ACCOUNT,
    token,
    email: STAND_IN_EMAIL,
  }),
  identityOf: () => okAsync(undefined),
  signedIn: notHere,
  read: async () => ({ kind: 'none' }),
  signOut: notHere,
}

/**
 * Stand-ins for the passwords, account links and mails, for the specs of the sign-up, the sign-in
 * and the verification over a stand-in for Better Auth: every one of them fails, as none is meant
 * to be asked.
 */
export const noAccounts: Pick<
  AuthMountDeps,
  'passwords' | 'resets' | 'emailChanges' | 'mails' | 'profiles'
> = {
  passwords: {
    requestReset: notHere,
    hash: notHere,
    reset: notHere,
    change: notHere,
    matches: notHere,
    // Every email reads alike before and after Better Auth's answer: the stand-in's account, its
    // one password, nothing a confirmation moved or a reset changed.
    credentialOf: () =>
      okAsync({ identity: STAND_IN_ACCOUNT, hash: 'stand-in-hash', start: undefined }),
  },
  resets: { read: notHere },
  emailChanges: {
    ask: notHere,
    cancel: notHere,
    read: () => okAsync({ kind: 'invalid' }),
    claim: notHere,
    move: notHere,
  },
  mails: {
    confirmEmail: () => undefined,
    passwordChanged: () => undefined,
    emailChanged: () => undefined,
  },
  profiles: { queue: () => undefined },
}

/**
 * The mount over a stand-in answering `answer`, with real limits on a manual clock and a stand-in
 * registry whose closes resolve once `closing` does.
 */
export function mountedOnFakeAuth(
  answer: (request: Request) => Response | Promise<Response>,
  closing?: Promise<void>,
) {
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
      ...noAccounts,
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
 * clock, and the accounts' turns (`turns`), which a test may hold to make work wait.
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
  const accounts = accountServicesOf(opened)
  const turns = new KeyedTurns<string>()
  /** The identities whose profile was asked to follow their email, in order. */
  const followed: IdentityId[] = []
  const route = authHandler({
    auth: opened.auth,
    sessions: {
      verificationOf: (token) => sessions.verificationOf(token),
      identityOf: (email) => sessions.identityOf(email),
      signedIn: (signed) =>
        options.readbackFails === true
          ? errAsync(dataError('data:QUERY_FAILED', READBACK_FAILURE))
          : sessions.signedIn(signed),
      read: (token) => sessions.read(token),
      signOut: (token) => sessions.signOut(token),
    },
    ...accounts,
    profiles: {
      queue: (identity) => {
        followed.push(identity)
      },
    },
    limits: new RequestLimits({ clock: opened.clock }),
    connections: {
      close: (identity, device, code) => {
        closes.push([identity, device, code])

        return registry.close(identity, device, code)
      },
    },
    clock: opened.clock,
    accounts: turns,
  })
  /** Ann's identity, once she signed up. */
  const annsId = async (): Promise<IdentityId> => {
    const identity = (await sessions.identityOf(ANN))._unsafeUnwrap()

    if (identity === undefined) {
      throw new Error('the account has not signed up')
    }

    return identity
  }

  return {
    ...opened,
    ...accounts,
    sessions,
    registry,
    failures,
    closes,
    route,
    annsId,
    turns,
    followed,
  }
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
    body: { name: 'Ann', email, password: PASSWORD, locale: 'en' },
    headers: deviceHeaders('laptop'),
  })

  return linkToken(await outbox.next(email, seen))
}

/** A sign-up of `email` with `password`, as the web sends it from the front's origin. */
export function signUpRequest(email: string, password = PASSWORD): Request {
  return new Request('http://gateway.test/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ name: 'Ann', email, password, locale: 'en' }),
  })
}

/** A sign-in of `email` with `password` from `device`, as the web sends it from the front's origin. */
export function signInRequest(email: string, password: string, device: string): Request {
  const headers = deviceHeaders(device)

  headers.set('content-type', 'application/json')

  return new Request('http://gateway.test/auth/sign-in/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
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

/** Who a request comes from: the device it names, and the session token it carries, if any. */
export interface Sender {
  readonly device: string
  readonly token?: string
}

/**
 * A POST of `body` as JSON to `path` of the mount, as the web sends it from the front's origin:
 * from `sender`'s device with its session token when it is named, from a device that names none
 * otherwise.
 */
export function postTo(path: string, body: unknown, sender?: Sender): Request {
  const headers =
    sender === undefined ? new Headers({ origin: ORIGIN }) : deviceHeaders(sender.device)

  headers.set('content-type', 'application/json')

  if (sender?.token !== undefined) {
    headers.set('authorization', `Bearer ${sender.token}`)
  }

  return new Request(`http://gateway.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

/** An account signed in on devices, each with a sync socket in the registry. */
export interface SignedInAccount {
  readonly identity: IdentityId
  /** The raw session token of each device, by the device's id. */
  readonly tokens: ReadonlyMap<string, string>
  /** The socket of each device, which records the codes it is closed with. */
  readonly sockets: ReadonlyMap<string, ReturnType<typeof fakeConnection>>
  /** The sender of a request from `device`, with its session token. */
  on(device: string): Sender
}

/**
 * Signs `email` up with `password`, verifies it through its mail on the first of `devices` and
 * signs it in on each other one, each device then saying hello with a socket in `registry`.
 */
export async function signedInOn(
  mounted: Awaited<ReturnType<typeof mountedOnRealAuth>>,
  email: string,
  devices: readonly [string, ...string[]],
  password = PASSWORD,
): Promise<SignedInAccount> {
  const [first, ...others] = devices
  const signedUp = await signUpOn(mounted.auth, email, deviceHeaders(first), { password })
  const identity = idSchemas.identity.schema.parse(signedUp.user.id)
  const tokens = new Map([[first, signedUp.token]])

  for (const device of others) {
    const signedIn = await mounted.auth.api.signInEmail({
      body: { email, password },
      headers: deviceHeaders(device),
    })

    tokens.set(device, signedIn.token)
  }

  const sockets = new Map(devices.map((device) => [device, fakeConnection()] as const))

  for (const [device, socket] of sockets) {
    mounted.registry.add(identity, device, socket, mounted.registry.epoch())
  }

  return {
    identity,
    tokens,
    sockets,
    on: (device) => {
      const token = tokens.get(device)

      return token === undefined ? { device } : { device, token }
    },
  }
}

/** How long a test waits for work that hashes a password to reach its floor, on a busy host. */
export const ARGON2_WAIT = { timeout: 10_000 }

/**
 * The answer of a request held back by a floor of `floorMs`: once the floor's timer is scheduled
 * on `clock`, the clock is moved past it.
 */
export async function pastFloor(
  clock: ManualClock,
  answer: Promise<Response | undefined>,
  floorMs: number,
): Promise<Response | undefined> {
  await vi.waitFor(() => expect(clock.pending()).toBeGreaterThan(0), ARGON2_WAIT)
  await clock.advance(floorMs)

  return answer
}

/**
 * Holds `key`'s turn on `turns` until the answer is called: work asked under that key from then
 * on waits behind it. Resolves once the turn is held.
 */
export async function holdTurn(turns: KeyedTurns<string>, key: string): Promise<() => void> {
  let release = (): void => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = (): void => {}
  const holding = new Promise<void>((resolve) => {
    held = resolve
  })

  void turns.run(key, () => {
    held()

    return released
  })
  await holding

  return release
}

/** How many turns of a key `turns` was asked for from now on, by key. */
export function turnsAsked(turns: KeyedTurns<string>): (key: string) => number {
  const run = vi.spyOn(turns, 'run')

  onTestFinished(() => {
    run.mockRestore()
  })

  return (key) => run.mock.calls.filter(([asked]) => asked === key).length
}

/** A query a test holds until it releases it, once it was asked. */
export interface HeldQuery {
  /** Whether the query was asked and waits. */
  paused(): boolean
  release(): void
}

/** Better Auth's adapter writes a session with an insert into its table. */
export const isSessionInsert = (text: string): boolean =>
  text.startsWith('INSERT') && text.includes('`device_session`')

/** Better Auth's adapter looks an account up by its email in its table. */
export const isAccountLookup = (text: string): boolean =>
  text.startsWith('SELECT') && text.includes('FROM `identity`') && text.includes('email')

/**
 * A directory for `openAuth` whose queries a test may hold: `hold(matches)` makes the next query
 * `matches` takes, from then on, wait until the hold is released.
 */
export function heldQueries() {
  const holds: Array<{
    readonly matches: (text: string) => boolean
    taken: boolean
    readonly released: Promise<void>
    asked: boolean
  }> = []

  return {
    directory: (local: LocalDb) =>
      interceptQueries(local, (text) => {
        const hold = holds.find((each) => !each.taken && each.matches(text))

        if (hold === undefined) {
          return undefined
        }

        hold.taken = true
        hold.asked = true

        return hold.released
      }),
    hold: (matches: (text: string) => boolean): HeldQuery => {
      let release = (): void => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const hold = { matches, taken: false, released, asked: false }

      holds.push(hold)

      return { paused: () => hold.asked, release: () => release() }
    },
  }
}
