/**
 * Accounts signed in to a directory for the console's route specs: Better Auth and the gateway's
 * sessions over one in-memory directory, accounts signed up and verified on their own device with
 * the platform role a test gives them, and the requests they send.
 */

import { type IdentityId, idSchemas } from '@workspace/ids'

import {
  AUTH_SECRET,
  deviceHeaders,
  type OpenedAuth,
  openAuth,
  signUpOn,
} from '../../auth/__fixtures__/auth-instance'
import identityRoleSetStatement from '../../auth/__fixtures__/identity-role-set.surql'
import { AuthSessions } from '../../auth/auth-sessions'
import { DEVICE_HEADER } from '../../auth/bearer-caller'
import { ADMISSION_HEADER } from '../../auth/session-hooks'

/** The password every account of these specs signs up with. */
const PASSWORD = 'Pass-word-1'

/** A directory with Better Auth over it and the gateway's sessions, which read every caller. */
export interface ConsoleAuth extends OpenedAuth {
  readonly sessions: AuthSessions
}

/** Closes what a test opened. */
const opened: ConsoleAuth[] = []

/** Closes every directory the test opened. */
export async function closeConsoleAuth(): Promise<void> {
  for (const each of opened.splice(0)) {
    await each.close()
  }
}

/** A fresh directory with Better Auth and the gateway's sessions over it. */
export async function openConsoleAuth(): Promise<ConsoleAuth> {
  const auth = await openAuth()
  const each = {
    ...auth,
    sessions: new AuthSessions({
      auth: auth.auth,
      directory: auth.local,
      clock: auth.clock,
      secret: AUTH_SECRET,
    }),
  }

  opened.push(each)

  return each
}

/** An account signed in on its device: its identity and email, the device, and its token. */
export interface SignedIn {
  readonly identity: IdentityId
  readonly email: string
  readonly device: string
  readonly token: string
}

/** The device each account of these specs signs up on. */
export const deviceOf = (email: string): string => `device-${email}`

/** Writes `role` as the account's platform role, as the host's command does. */
export async function setRole(
  auth: ConsoleAuth,
  identity: IdentityId,
  role: 'operator' | 'user',
): Promise<void> {
  await auth.local.db.query(identityRoleSetStatement, { identity, role })
}

/**
 * Signs `email` up and verified on its own device, named `name` (the email when left out), with
 * the platform role `role` (none when left out).
 */
export async function signedUp(
  auth: ConsoleAuth,
  email: string,
  options: { readonly role?: 'operator' | 'user'; readonly name?: string } = {},
): Promise<SignedIn> {
  const device = deviceOf(email)
  const { token, user } = await signUpOn(auth.auth, email, deviceHeaders(device), {
    password: PASSWORD,
    name: options.name ?? email,
  })
  const identity = idSchemas.identity.schema.parse(user.id)

  if (options.role !== undefined) {
    await setRole(auth, identity, options.role)
  }

  return { identity, email: user.email, device, token }
}

/**
 * Signs `account` in on `device` as the gateway's sign-in route asks Better Auth to: the session
 * waits for its admission, which never comes. Answers its raw token.
 */
export async function waitingSignIn(
  auth: ConsoleAuth,
  account: SignedIn,
  device: string,
): Promise<string> {
  const headers = deviceHeaders(device)

  headers.set(ADMISSION_HEADER, 'pending')

  const { token } = await auth.auth.api.signInEmail({
    body: { email: account.email, password: PASSWORD },
    headers,
  })

  return token
}

/** What a console request carries: whose session, from which device. */
export interface Ask {
  /** The account whose token goes as `Authorization: Bearer`, from its own device. */
  readonly as?: SignedIn
  /** The token sent instead of the account's own. */
  readonly token?: string
  /** The `X-Perch-Device` header instead of the account's device; `null` leaves it out. */
  readonly device?: string | null
}

/** A console request of `method` to `path` (with its query). */
export function consoleRequest(method: string, path: string, ask: Ask = {}): Request {
  const headers = new Headers()
  const token = ask.token ?? ask.as?.token
  const device = ask.device === undefined ? ask.as?.device : ask.device

  if (token !== undefined) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (device !== undefined && device !== null) {
    headers.set(DEVICE_HEADER, device)
  }

  return new Request(`http://gateway.test${path}`, { method, headers })
}
