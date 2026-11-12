import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

import type { LocalDb } from '@workspace/data'
import { surrealAuthAdapter } from '@workspace/data/better-auth-adapter'
import { SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { PASSWORD_LENGTH } from '@workspace/kernel'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { MailPort } from '../mail'

import { ResetLinks } from './account-links'
import { AccountMails } from './account-mails'
import { ADMIN_PATHS } from './admin-paths'
import { adminPlugin } from './admin-plugin'
import { type AuthLog, authErrorReporter, authLogger } from './auth-log'
import { AUTH_MODELS, generateAuthId } from './auth-models'
import { hashPassword, verifyPassword } from './password-hash'
import { RESET_LINK_LIFETIME_S, resetMailer } from './reset-mail'
import { sessionHooks } from './session-hooks'
import { verificationMailer } from './verification-mail'

/**
 * How long a session lives after its sign-in, and again after each time its device is seen: the
 * instance and the gateway's own extension of a session (`DeviceSessions.seen`) both use it.
 */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How many devices one account keeps signed in at once: a sign-in that would bring it past them
 * asks first, then signs out the device seen least recently (`AuthSessions.admit`).
 */
export const DEVICE_LIMIT = 10

/** How long a verification link verifies, in seconds: a day. */
export const VERIFICATION_LINK_LIFETIME_S = 24 * 60 * 60

export interface AuthInstanceOptions {
  /** The directory database. */
  readonly local: LocalDb
  readonly secret: string
  /**
   * The public URL of the auth routes as the browser reaches them through the front: its
   * `/backend` prefix and the `/auth` segment included (`${publicUrl}/backend/auth`). Better Auth
   * serves only requests under this URL's path, so a request reaching the gateway as `/auth/<rest>`
   * must be handed over as `/backend/auth/<rest>`.
   */
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly clock: Clock
  /** The front's origin, with no trailing slash: the base of the links the mails carry. */
  readonly publicUrl: string
  /** Where the account mails go. */
  readonly mail: MailPort
  /** Where Better Auth's errors, and the mails that did not go out, are reported by their codes. */
  readonly log: AuthLog
}

/** The options Better Auth runs with; also what the schema check reads. */
export function authOptions(options: AuthInstanceOptions) {
  return {
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    database: surrealAuthAdapter(options.local),
    // The admin plugin keeps an account's role and ban and refuses a banned account a session;
    // none of its endpoints is reachable (`adminPlugin`, `disabledPaths` below).
    plugins: [bearer(), adminPlugin()],
    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
      // A new password's length, as the rules of a new password set it (the auth mount checks
      // the rest at sign-up). Better Auth checks it on a new password only, never at a sign-in, so
      // an account whose password was set before the rules still signs in.
      minPasswordLength: PASSWORD_LENGTH.min,
      maxPasswordLength: PASSWORD_LENGTH.max,
      // No session before the email is verified: a sign-up answers with no token, a taken email
      // as a new one, and a sign-in of an unverified account is refused after its password.
      requireEmailVerification: true,
      // A reset link lives an hour; each request's link replaces the account's earlier ones, and
      // its mail links to the front's own screen.
      resetPasswordTokenExpiresIn: RESET_LINK_LIFETIME_S,
      sendResetPassword: resetMailer({
        links: new ResetLinks(options.local),
        mails: new AccountMails({
          mail: options.mail,
          directory: options.local,
          publicUrl: options.publicUrl,
          log: options.log,
        }),
      }),
      // Better Auth's own ending at a reset deletes the sessions' rows in bulk; the gateway ends
      // every session of the account itself, by its own update, and closes their sockets.
      revokeSessionsOnPasswordReset: false,
    },
    emailVerification: {
      // Every sign-up sends the mail; a taken email's sends none.
      sendOnSignUp: true,
      // A sign-in of an unverified account sends nothing; the person asks for the mail again.
      sendOnSignIn: false,
      // The first verification signs the device that opened the link in; a link opened again
      // verifies nothing and signs nothing in.
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_LINK_LIFETIME_S,
      sendVerificationEmail: verificationMailer({
        mail: options.mail,
        directory: options.local,
        publicUrl: options.publicUrl,
        secret: options.secret,
        log: options.log,
      }),
    },
    user: {
      ...AUTH_MODELS.user,
      additionalFields: {
        // The language the account signed up in: its mails speak it until its settings name one.
        locale: {
          type: 'string',
          required: false,
          input: true,
          validator: { input: z.enum(SUPPORTED_LOCALES) },
        },
      },
    },
    session: {
      ...AUTH_MODELS.session,
      additionalFields: {
        device: { type: 'string', required: true, input: false },
        label: { type: 'string', required: true, input: false },
        // A sign-in's session until the gateway admits it against the limit of devices, and a
        // verification's until the gateway admits it: no caller reads a session that waits.
        pending: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
      expiresIn: SESSION_LIFETIME_MS / 1000,
      // Better Auth's refresh stays off, so it never writes `expires_at` after sign-in: its write is
      // unconditional and could revive a session the gateway ended. The gateway extends a session
      // itself, where its device is seen.
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      // No `preserveSessionInDatabase`: it keeps rows only beside a secondary storage. The
      // session hooks keep them: a delete ends the row instead.
    },
    account: AUTH_MODELS.account,
    verification: {
      ...AUTH_MODELS.verification,
      // Better Auth deletes every expired row whenever it looks a value up, so a reset link past
      // its hour would read as one nobody had. The rows stay instead: an account keeps one reset
      // link and one pending change of its email at most, each replaced by the next.
      disableCleanup: true,
    },
    advanced: {
      database: { generateId: generateAuthId },
    },
    // Better Auth's bulk revocations end sessions by deleting their rows. `/revoke-sessions` deletes
    // them in one call, which the session hooks can refuse only at its first row, so it may end
    // none. Bulk endings go through the gateway's own update by identity, `/revoke-other-sessions`
    // included. This guards the HTTP handler only: `auth.api` calls still reach these endpoints.
    // `/change-password` ends the other sessions through the same bulk delete when it is asked
    // to, and sets the password apart from them: the gateway changes a password itself, the new
    // password and every ending in one transaction (`AccountPasswords`). `/change-email` signs a
    // device in at its confirmation and mails through the verification mail: the gateway asks for
    // and confirms a change itself (`EmailChanges`). Every endpoint of the admin plugin is switched
    // off too, read from the plugin's own table (`ADMIN_PATHS`): the gateway keeps the plugin for
    // its fields and its refusal of a banned account's session only. Its endpoints would set a
    // role, ban, list, impersonate or remove an account outside the account's turns, and end
    // sessions by deleting their rows, their sockets left open.
    disabledPaths: [
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/change-password',
      '/change-email',
      ...ADMIN_PATHS,
    ],
    // Better Auth's limiter restarts its count only after a pause as long as its window, so it
    // refuses an address's 21st request however slowly the 20 before it came; the auth mount
    // applies the gateway's fixed windows instead.
    rateLimit: { enabled: false },
    // Better Auth's own words and arguments never reach the log: an error is a code and a fixed
    // message, and a failure that is not its own answer is answered an empty 500.
    logger: authLogger(options.log),
    onAPIError: { onError: authErrorReporter(options.log) },
    databaseHooks: { session: sessionHooks(options.clock, options.local) },
  } satisfies Parameters<typeof betterAuth>[0]
}

export function createAuthInstance(options: AuthInstanceOptions) {
  return betterAuth(authOptions(options))
}

export type AuthInstance = ReturnType<typeof createAuthInstance>
