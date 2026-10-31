/**
 * A Better Auth instance on an embedded directory database, for the specs of the auth module: the
 * instance, the database to read rows back from, and the requests a device signs up with.
 */

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../../config'
import { Outbox } from '../../mail/__fixtures__/outbox'
import { type AuthInstance, createAuthInstance } from '../auth-instance'
import type { AuthLog } from '../auth-log'
import { DEVICE_HEADER, DEVICE_LABEL_HEADER } from '../session-hooks'

/** The origin the instance trusts, which every request names, and the front's origin. */
const ORIGIN = 'http://localhost'

/** The secret the instance signs with, verification links' tokens among what it signs. Test-only. */
export const AUTH_SECRET = 'test-secret-0123456789-0123456789-0123456789'

/** The public URL of the auth routes, behind the front's `/backend` prefix. */
export const AUTH_URL = `${ORIGIN}/backend/auth`

/**
 * Where the session hooks' clock starts: a fixed instant in the past. Better Auth judges expiry by
 * the system clock, so an end the hooks write must lie behind it to read as ended, and an end at
 * this instant or later is told apart from the epoch.
 */
export const CLOCK_START = Date.UTC(2026, 9, 1)

/** A line the instance logged, as the auth module's log takes it. */
export interface AuthLogLine {
  readonly level: 'error' | 'warn'
  readonly code: string
  readonly message: string
}

export interface OpenedAuth {
  readonly auth: AuthInstance
  readonly local: LocalDb
  /** The clock of the session hooks; a test moves it to mark when an ending happens. */
  readonly clock: ManualClock
  /** Where the instance's mails go, oldest first. */
  readonly outbox: Outbox
  /** What the instance logged, oldest first: Better Auth's errors and the mails that did not go out. */
  readonly logs: AuthLogLine[]
  close(): Promise<void>
}

export interface OpenAuthOptions {
  /**
   * What the instance reaches the directory through, made from the directory: a test watches or
   * holds the instance's queries with it. `local` stays the directory itself.
   */
  readonly directory?: (local: LocalDb) => LocalDb
}

const OUTBOXES = new WeakMap<AuthInstance, Outbox>()

/** A Better Auth instance over a fresh directory database, its mails kept in an outbox. */
export async function openAuth(options: OpenAuthOptions = {}): Promise<OpenedAuth> {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()
  const clock = manualClock(CLOCK_START)
  const outbox = new Outbox()
  const logs: AuthLogLine[] = []
  const log: AuthLog = {
    error: ({ code }, message) => logs.push({ level: 'error', code, message }),
    warn: ({ code }, message) => logs.push({ level: 'warn', code, message }),
  }
  const auth = createAuthInstance({
    local: options.directory?.(local) ?? local,
    secret: AUTH_SECRET,
    baseURL: AUTH_URL,
    trustedOrigins: [ORIGIN],
    clock,
    publicUrl: ORIGIN,
    mail: outbox,
    log,
  })

  OUTBOXES.set(auth, outbox)

  return { auth, local, clock, outbox, logs, close: () => local.close() }
}

/** Names where the mails of an instance the fixture did not open go (a gateway root's). */
export function mailsOf(auth: AuthInstance, outbox: Outbox): void {
  OUTBOXES.set(auth, outbox)
}

/** The outbox of an instance the fixture opened or was told of. */
export function outboxOf(auth: AuthInstance): Outbox {
  const outbox = OUTBOXES.get(auth)

  if (outbox === undefined) {
    throw new Error('the instance has no outbox: open it with openAuth, or name it with mailsOf')
  }

  return outbox
}

/** The headers of a request from device `id`, labelled `label`, sent from the trusted origin. */
export function deviceHeaders(id: string, label = 'Firefox on Linux'): Headers {
  return new Headers({ [DEVICE_HEADER]: id, [DEVICE_LABEL_HEADER]: label, origin: ORIGIN })
}

/** Signs `email` up with the password `pass-word-1` from the device the headers name. */
export async function signUpOn(
  auth: AuthInstance,
  email: string,
  headers: Headers,
): Promise<{ token: string; user: { id: string; email: string } }> {
  const { headers: answered, response } = await auth.api.signUpEmail({
    body: { name: 'Ann', email, password: 'pass-word-1' },
    headers,
    returnHeaders: true,
  })
  const token = response.token ?? answered.get('set-auth-token')

  if (token === null) {
    throw new Error(`the sign-up of ${email} returned no session token`)
  }

  return { token, user: response.user }
}
