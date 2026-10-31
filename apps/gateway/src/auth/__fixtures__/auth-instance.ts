/**
 * A Better Auth instance on an embedded directory database, for the specs of the auth module: the
 * instance, the database to read rows back from, and the requests a device signs up with.
 */

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../../config'
import { type AuthInstance, createAuthInstance } from '../auth-instance'
import { DEVICE_HEADER, DEVICE_LABEL_HEADER } from '../session-hooks'

/** The origin the instance trusts, which every request names. */
const ORIGIN = 'http://localhost'

/** The public URL of the auth routes, behind the front's `/backend` prefix. */
export const AUTH_URL = `${ORIGIN}/backend/auth`

/**
 * Where the session hooks' clock starts: a fixed instant in the past. Better Auth judges expiry by
 * the system clock, so an end the hooks write must lie behind it to read as ended, and an end at
 * this instant or later is told apart from the epoch.
 */
export const CLOCK_START = Date.UTC(2026, 9, 1)

export interface OpenedAuth {
  readonly auth: AuthInstance
  readonly local: LocalDb
  /** The clock of the session hooks; a test moves it to mark when an ending happens. */
  readonly clock: ManualClock
  close(): Promise<void>
}

export interface OpenAuthOptions {
  /**
   * What the instance reaches the directory through, made from the directory: a test watches or
   * holds the instance's queries with it. `local` stays the directory itself.
   */
  readonly directory?: (local: LocalDb) => LocalDb
}

/** A Better Auth instance over a fresh directory database. */
export async function openAuth(options: OpenAuthOptions = {}): Promise<OpenedAuth> {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()
  const clock = manualClock(CLOCK_START)
  const auth = createAuthInstance({
    local: options.directory?.(local) ?? local,
    secret: 'test-secret-0123456789-0123456789-0123456789',
    baseURL: AUTH_URL,
    trustedOrigins: [ORIGIN],
    clock,
  })

  return { auth, local, clock, close: () => local.close() }
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
