import { describe, expect, it } from 'bun:test'

import {
  operatorArguments,
  operatorFailure,
  operatorNotStarted,
  STAND_PASSWORD,
  standAddress,
} from './operators'

describe("the platform's operators of an e2e run", () => {
  it("runs the host's operator command against the run's stand as its root user, then the action and the email", () => {
    const args = operatorArguments('grant', 'ann.1@example.test', 'http://127.0.0.1:8010')

    expect(args[0]).toEndWith('/apps/gateway/scripts/operator/cli.ts')
    expect(args.slice(1)).toEqual([
      '--url=http://127.0.0.1:8010',
      '--user=root',
      `--pass=${STAND_PASSWORD}`,
      'grant',
      'ann.1@example.test',
    ])
    expect(operatorArguments('revoke', 'ann.1@example.test', 'http://127.0.0.1:8010').at(-2)).toBe(
      'revoke',
    )
  })

  it('reads the stand from SURREAL_URL, and refuses a run without it in words that say how to run', () => {
    expect(standAddress({ SURREAL_URL: 'http://127.0.0.1:8010' })).toBe('http://127.0.0.1:8010')
    expect(() => standAddress({})).toThrow(/SURREAL_URL .*bun run test:e2e/)
    expect(() => standAddress({ SURREAL_URL: 'ws://127.0.0.1:8010' })).toThrow(/SURREAL_URL/)
  })

  it("fails with the command's exit code and its own words, never with its arguments or the password", () => {
    const failure = operatorFailure('grant', {
      code: 1,
      signal: null,
      output: `operator: no account has the email ann.1@example.test\nsigned in with ${STAND_PASSWORD}\n`,
    })

    expect(failure.message).toContain('exited 1')
    expect(failure.message).toContain('no account has the email ann.1@example.test')
    expect(failure.message).not.toContain(STAND_PASSWORD)
    expect(failure.message).not.toContain('--pass')
  })

  it('says which signal ended a command that did not exit, and what it printed', () => {
    const failure = operatorFailure('revoke', { code: null, signal: 'SIGTERM', output: '' })

    expect(failure.message).toContain('revoke')
    expect(failure.message).toContain('SIGTERM')
  })

  it('names only the code of an error that kept the command from starting', () => {
    const cause = Object.assign(
      new Error(`spawn bun ENOENT --pass=${STAND_PASSWORD} ann.1@example.test`),
      {
        code: 'ENOENT',
      },
    )
    const failure = operatorNotStarted(cause)

    expect(failure.message).toContain('ENOENT')
    expect(failure.message).not.toContain(STAND_PASSWORD)
    expect(failure.message).not.toContain('ann.1@example.test')
    expect(failure.cause).toBeUndefined()
  })
})
