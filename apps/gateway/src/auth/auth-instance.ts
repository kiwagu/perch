import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

import type { LocalDb } from '@workspace/data'
import { surrealAuthAdapter } from '@workspace/data/better-auth-adapter'
import type { Clock } from '@workspace/replica'

import { AUTH_MODELS, generateAuthId } from './auth-models'
import { hashPassword, verifyPassword } from './password-hash'
import { sessionHooks } from './session-hooks'

/**
 * How long a session lives after its sign-in, and again after each time its device is seen: the
 * instance and the gateway's own extension of a session (`DeviceSessions.seen`) both use it.
 */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

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
}

/** The options Better Auth runs with; also what the schema check reads. */
export function authOptions(options: AuthInstanceOptions) {
  return {
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    database: surrealAuthAdapter(options.local),
    plugins: [bearer()],
    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: AUTH_MODELS.user,
    session: {
      ...AUTH_MODELS.session,
      additionalFields: {
        device: { type: 'string', required: true, input: false },
        label: { type: 'string', required: true, input: false },
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
    verification: AUTH_MODELS.verification,
    advanced: {
      database: { generateId: generateAuthId },
    },
    // Better Auth's bulk revocations end sessions by deleting their rows. `/revoke-sessions` deletes
    // them in one call, which the session hooks can refuse only at its first row, so it may end
    // none. Bulk endings go through the gateway's own update by identity, `/revoke-other-sessions`
    // included. This guards the HTTP handler only: `auth.api` calls still reach these endpoints.
    // `/change-password` ends the other sessions through the same bulk delete, so it fails open: it
    // stays off until a password change ends them through the gateway's own update.
    disabledPaths: ['/revoke-sessions', '/revoke-other-sessions', '/change-password'],
    // Better Auth's limiter restarts its count only after a pause as long as its window, so it
    // refuses an address's 21st request however slowly the 20 before it came; the auth mount
    // applies the gateway's fixed windows instead.
    rateLimit: { enabled: false },
    databaseHooks: { session: sessionHooks(options.clock, options.local) },
  } satisfies Parameters<typeof betterAuth>[0]
}

export function createAuthInstance(options: AuthInstanceOptions) {
  return betterAuth(authOptions(options))
}

export type AuthInstance = ReturnType<typeof createAuthInstance>
