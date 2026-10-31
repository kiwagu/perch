import { APIError, isAPIError } from 'better-auth/api'

import { z } from '@workspace/zod'

/**
 * Where the auth module reports what went wrong: a code and a fixed message, never a value it
 * read (an address, a token, a query's bindings, an error's cause).
 */
export interface AuthLog {
  error(fields: { readonly code: string }, message: string): void
  warn(fields: { readonly code: string }, message: string): void
}

/** Better Auth's error messages the gateway names, by their start; any other is `auth:LIBRARY`. */
const KNOWN: ReadonlyArray<readonly [start: string, code: string]> = [
  ['Failed to create user', 'auth:CREATE_USER_FAILED'],
  ['Failed to create session', 'auth:CREATE_SESSION_FAILED'],
  ['Failed to run background task', 'auth:BACKGROUND_TASK_FAILED'],
]

const codeOf = (message: string): string =>
  KNOWN.find(([start]) => message.startsWith(start))?.[1] ?? 'auth:LIBRARY'

/**
 * Better Auth's `logger`: its errors by a code from the table above and a fixed message. Its own
 * words and every argument (an error, a query, an address) are dropped: they can carry what a
 * log must not. Its warnings (a wrong password, an unknown email) are not logged.
 */
export function authLogger(log: AuthLog) {
  return {
    level: 'error' as const,
    // Every argument after the message is dropped unread.
    log: (
      level: 'debug' | 'info' | 'warn' | 'error',
      message: string,
      ..._dropped: unknown[]
    ): void => {
      if (level === 'error') {
        log.error({ code: codeOf(message) }, 'Better Auth reported an error')
      }
    },
  }
}

const apiCode = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })

/**
 * Better Auth's `onAPIError.onError`, which replaces its own logging of an endpoint's failure: the
 * failure by Better Auth's code when it names one, `auth:UNEXPECTED` otherwise, nothing else of it.
 * A failure that is not Better Auth's own answer (a query that failed, say) is then answered an
 * empty 500 by throwing Better Auth's own: its router prints any other failure whole to stderr
 * after this hook, its cause and the query's bindings with it. Better Auth's own answers go on
 * to the client as they are.
 */
export function authErrorReporter(log: AuthLog) {
  return (error: unknown): void => {
    const code = isAPIError(error) ? apiCode.safeParse(error.body) : undefined

    log.error(
      { code: code?.success ? `auth:${code.data.code}` : 'auth:UNEXPECTED' },
      'a Better Auth endpoint failed',
    )

    if (!isAPIError(error)) {
      throw new APIError('INTERNAL_SERVER_ERROR')
    }
  }
}
