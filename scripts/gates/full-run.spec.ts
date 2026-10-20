import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { FULL_RUN, isFullRun } from './full-run.ts'
import { GATES } from './tree.ts'

/** The root scripts that run the suites, by gate. */
const SUITE_SCRIPT = { db: 'test:db', e2e: 'test:e2e' } as const

const scripts = (): Readonly<Record<string, string>> => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  )

  return typeof manifest === 'object' &&
    manifest !== null &&
    'scripts' in manifest &&
    typeof manifest.scripts === 'object' &&
    manifest.scripts !== null
    ? Object.fromEntries(
        Object.entries(manifest.scripts).flatMap(([name, script]) =>
          typeof script === 'string' ? [[name, script]] : [],
        ),
      )
    : {}
}

describe('the full run of a suite', () => {
  it.each(GATES)('is the command the %s script wraps, with nothing after it', (gate) => {
    const script = scripts()[SUITE_SCRIPT[gate]] ?? ''
    const wrapped = script.split(`record-after.ts ${gate} -- `)[1]

    expect(wrapped?.split(' ')).toEqual([...FULL_RUN[gate]])
  })

  it.each(GATES)('is the %s command itself', (gate) => {
    expect(isFullRun(gate, FULL_RUN[gate])).toBe(true)
  })

  it('is not a run given a spec, a filter or any other argument', () => {
    expect(isFullRun('e2e', [...FULL_RUN.e2e, 'sync/09-key-renewal'])).toBe(false)
    expect(isFullRun('e2e', [...FULL_RUN.e2e, '--reporter=list,json'])).toBe(false)
    expect(isFullRun('db', [...FULL_RUN.db, '--filter=@workspace/gateway'])).toBe(false)
  })

  it('is not another command, nor a part of the full one', () => {
    expect(isFullRun('e2e', ['bun', 'tests/e2e/scripts/other.ts'])).toBe(false)
    expect(isFullRun('db', FULL_RUN.e2e)).toBe(false)
    expect(isFullRun('db', FULL_RUN.db.slice(0, -1))).toBe(false)
  })
})
