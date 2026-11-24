/**
 * A Better Auth instance on an embedded directory database, for the specs of the auth module: the
 * instance, the database to read rows back from, the requests a device signs up with, and a
 * sign-up verified through its mail, its session admitted as the gateway admits a verification's.
 */

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import type { Locale } from '@workspace/i18n/translator'
import { idSchemas } from '@workspace/ids'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../../config'
import { linkToken, Outbox } from '../../mail/__fixtures__/outbox'
import { AccountDeletions, EmailChanges, ResetLinks, verificationClaims } from '../account-links'
import { AccountMails } from '../account-mails'
import { AccountPasswords } from '../account-passwords'
import { type AuthInstance, createAuthInstance } from '../auth-instance'
import type { AuthLog } from '../auth-log'
import { AuthSessions } from '../auth-sessions'
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
  /**
   * What the instance reaches the directory through: `local` itself, or what `options.directory`
   * made of it, so the gateway's own statements a test runs beside the instance are watched or held
   * alike.
   */
  readonly directory: LocalDb
  /** Where the instance's log lines go, as the gateway's mails log theirs too. */
  readonly log: AuthLog
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

/** The gateway's sessions over each instance's directory, which admit a verification's session. */
const SESSIONS = new WeakMap<AuthInstance, AuthSessions>()

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
  const directory = options.directory?.(local) ?? local
  const auth = createAuthInstance({
    local: directory,
    secret: AUTH_SECRET,
    baseURL: AUTH_URL,
    trustedOrigins: [ORIGIN],
    clock,
    publicUrl: ORIGIN,
    mail: outbox,
    log,
  })

  OUTBOXES.set(auth, outbox)
  SESSIONS.set(auth, new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET }))

  return { auth, local, directory, log, clock, outbox, logs, close: () => local.close() }
}

/**
 * The gateway's services of passwords, account links and account mails over an instance the
 * fixture opened: its directory, its clock, its outbox and its log, as the composition root builds
 * them over the gateway's own.
 */
export function accountServicesOf(opened: OpenedAuth) {
  return {
    passwords: new AccountPasswords({
      auth: opened.auth,
      directory: opened.local,
      clock: opened.clock,
    }),
    resets: new ResetLinks(opened.local),
    emailChanges: new EmailChanges({
      directory: opened.local,
      secret: AUTH_SECRET,
      clock: opened.clock,
    }),
    accountDeletions: new AccountDeletions({
      directory: opened.local,
      secret: AUTH_SECRET,
      clock: opened.clock,
    }),
    mails: new AccountMails({
      mail: opened.outbox,
      directory: opened.local,
      publicUrl: ORIGIN,
      log: opened.log,
    }),
  }
}

/**
 * Names where the mails of an instance the fixture did not open go (a gateway root's), and the
 * gateway's sessions over its directory, which admit the session of a verification.
 */
export function mailsOf(auth: AuthInstance, outbox: Outbox, sessions: AuthSessions): void {
  OUTBOXES.set(auth, outbox)
  SESSIONS.set(auth, sessions)
}

/** The outbox of an instance the fixture opened or was told of. */
export function outboxOf(auth: AuthInstance): Outbox {
  const outbox = OUTBOXES.get(auth)

  if (outbox === undefined) {
    throw new Error('the instance has no outbox: open it with openAuth, or name it with mailsOf')
  }

  return outbox
}

/** The gateway's sessions over the directory of an instance the fixture opened or was told of. */
function sessionsOf(auth: AuthInstance): AuthSessions {
  const sessions = SESSIONS.get(auth)

  if (sessions === undefined) {
    throw new Error('the instance has no sessions: open it with openAuth, or name it with mailsOf')
  }

  return sessions
}

/** The headers of a request from device `id`, labelled `label`, sent from the trusted origin. */
export function deviceHeaders(id: string, label = 'Firefox on Linux'): Headers {
  return new Headers({ [DEVICE_HEADER]: id, [DEVICE_LABEL_HEADER]: label, origin: ORIGIN })
}

/**
 * Better Auth's own token inside the token of a verification link (`token`), which a spec hands
 * Better Auth's endpoint when it calls it directly; the mount reads the link's token itself. The
 * claims are read without the key, so the token of any instance's link reads; the test fails for
 * a token that names none.
 */
export function betterAuthToken(token: string): string {
  const [, payload] = token.split('.')

  return verificationClaims.parse(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()))
    .token
}

/**
 * Signs `email` up (the password `Pass-word-1` unless `options` names one) and verifies it through
 * the mail the sign-up sent, which signs in the device the headers name, as a person opening the
 * link on it does: Better Auth writes the session waiting for its admission, and the gateway's
 * sessions admit it, as the mount does before it hands the token out (`AuthSessions.admitVerified`;
 * the test fails unless it is admitted), so the device holds a session every read takes.
 */
export async function signUpOn(
  auth: AuthInstance,
  email: string,
  headers: Headers,
  options: {
    readonly locale?: Locale
    readonly password?: string
    readonly name?: string
  } = {},
): Promise<{ token: string; user: { id: string; email: string } }> {
  const outbox = outboxOf(auth)
  const seen = outbox.to(email).length

  await auth.api.signUpEmail({
    body: {
      name: options.name ?? 'Ann',
      email,
      password: options.password ?? 'Pass-word-1',
      locale: options.locale ?? 'en',
    },
    headers,
  })

  const token = betterAuthToken(linkToken(await outbox.next(email, seen)))
  const { headers: answered } = await auth.api.verifyEmail({
    query: { token },
    headers,
    returnHeaders: true,
  })
  const signed = answered.get('set-auth-token')
  const read =
    signed === null
      ? null
      : await auth.api.getSession({
          headers: new Headers({ authorization: `Bearer ${signed}` }),
        })

  if (read === null) {
    throw new Error('the verification signed nothing in')
  }

  const admission = await sessionsOf(auth).admitVerified(
    idSchemas.identity.schema.parse(read.user.id),
    read.session.token,
  )

  if (!admission.isOk() || admission.value.kind !== 'admitted') {
    throw new Error("the verification's session was not admitted")
  }

  return { token: read.session.token, user: { id: read.user.id, email: read.user.email } }
}
