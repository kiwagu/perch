import { describe, expect, it } from 'bun:test'

import { jsonOf, type Ran } from './json-command.ts'

/** A value no message may carry, standing for the stands' auth secret. */
const SECRET = 'sentinel-secret-7f3a9c1e5b'

const ran = (overrides: Partial<Ran>): Ran => ({
  status: 0,
  signal: null,
  stdout: '',
  stderr: '',
  ...overrides,
})

const UNSTARTABLE = 'put it on PATH'

describe('the JSON of a command', () => {
  it('is what it printed when it succeeds', () => {
    expect(jsonOf('mcproc --json ls', ran({ stdout: '[{"app":"web"}]' }), UNSTARTABLE)).toEqual({
      json: [{ app: 'web' }],
    })
  })

  it('names the command and its exit code when it fails, never a word of its output', () => {
    // mcproc quotes a value a template rendered when the manifest refuses it.
    const failed = ran({
      status: 1,
      stdout: `{"error":"${SECRET}"}`,
      stderr: `error: apps.gateway.port: must render to an integer, got "${SECRET}"`,
    })
    const message = jsonOf('mcproc --json describe', failed, UNSTARTABLE)

    expect(message).toBe(
      "mcproc --json describe failed with exit code 1; run it yourself to see why (bun run dev repeats none of its output, which may quote the stand's values)",
    )
    expect(JSON.stringify(message)).not.toContain(SECRET)
  })

  it('names the signal that stopped it', () => {
    expect(
      jsonOf(
        'mcproc --json ls',
        ran({ status: null, signal: 'SIGTERM', stderr: SECRET }),
        UNSTARTABLE,
      ),
    ).toStartWith('mcproc --json ls was stopped by SIGTERM; run it yourself to see why')
  })

  it('names the code of a command that could not start, and what to do', () => {
    const error = Object.assign(new Error(`spawnSync mcproc ENOENT ${SECRET}`), { code: 'ENOENT' })

    expect(jsonOf('mcproc --json ls', ran({ error, status: null }), UNSTARTABLE)).toBe(
      'mcproc --json ls could not run (ENOENT): put it on PATH',
    )
  })

  it('says it printed no JSON, without what it printed', () => {
    expect(jsonOf('mcproc --json ls', ran({ stdout: `not json ${SECRET}` }), UNSTARTABLE)).toBe(
      'mcproc --json ls printed no JSON',
    )
  })
})
