import { APIError, isAPIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'

import { type AuthLog, authErrorReporter, authLogger } from './auth-log'

/** A log that keeps every line it was given. */
function kept() {
  const lines: unknown[] = []
  const log: AuthLog = {
    error: (fields, message) => lines.push(['error', fields, message]),
    warn: (fields, message) => lines.push(['warn', fields, message]),
  }

  return { lines, log }
}

const MARKER = 'ann@example.test tok_MARKER_0123'

/** What `run` threw; the test fails when it threw nothing. */
function thrownBy(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }

  return expect.unreachable('a throw')
}

describe('authLogger and authErrorReporter', () => {
  it("log Better Auth's errors by a code and a fixed message, never its words or its arguments", () => {
    const { lines, log } = kept()
    const logger = authLogger(log)

    logger.log('error', 'Failed to create user', new Error(MARKER))
    logger.log('error', 'Failed to create session', { email: MARKER })
    logger.log('error', `Sign-up attempt for existing email: ${MARKER}`)
    logger.log('warn', `Invalid password for ${MARKER}`)
    logger.log('info', MARKER)

    expect(lines).toEqual([
      ['error', { code: 'auth:CREATE_USER_FAILED' }, 'Better Auth reported an error'],
      ['error', { code: 'auth:CREATE_SESSION_FAILED' }, 'Better Auth reported an error'],
      ['error', { code: 'auth:LIBRARY' }, 'Better Auth reported an error'],
    ])
    expect(JSON.stringify(lines)).not.toContain('MARKER')
  })

  it('report a failed endpoint by its code alone', () => {
    const { lines, log } = kept()
    const report = authErrorReporter(log)

    report(new APIError('BAD_REQUEST', { code: 'INVALID_TOKEN', message: MARKER }))
    report(new APIError('BAD_REQUEST', { code: MARKER, message: MARKER }))
    thrownBy(() => report(new Error(MARKER)))

    expect(lines).toEqual([
      ['error', { code: 'auth:INVALID_TOKEN' }, 'a Better Auth endpoint failed'],
      ['error', { code: 'auth:UNEXPECTED' }, 'a Better Auth endpoint failed'],
      ['error', { code: 'auth:UNEXPECTED' }, 'a Better Auth endpoint failed'],
    ])
    expect(JSON.stringify(lines)).not.toContain('MARKER')
  })

  it("answers a failure that is not Better Auth's own an empty 500, so its router prints nothing of it", () => {
    const { log } = kept()
    const thrown = thrownBy(() => authErrorReporter(log)(new Error(MARKER)))

    expect(isAPIError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ status: 'INTERNAL_SERVER_ERROR', body: undefined, message: '' })
    expect(isAPIError(thrown) ? thrown.cause : undefined).toBeUndefined()
  })
})
