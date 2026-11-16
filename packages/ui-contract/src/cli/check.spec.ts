import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONTRACT_VERSION } from '../anchors'
import { writeContractRepository } from '../contract-repository.fixture'
import { MODEL_FILE, migrate } from '../files'

import { check } from './check'

/** An e2e test naming an anchor the contract does not declare: an unresolved literal. */
const UNKNOWN_ANCHOR = 'no-such-anchor'
const TESTS = 'tests/e2e/src'
const VERSION_NOTE = `the contract is at version 1; this engine reads up to ${CONTRACT_VERSION}`

let root: string
let out: string[]
let err: string[]

/** Runs `check` on the repository, capturing what it prints: its exit code and both streams. */
function run(argv: readonly string[]): { code: number; out: string; err: string } {
  out = []
  err = []

  const code = check(argv)

  return { code, out: out.join('\n'), err: err.join('\n') }
}

/** The fixture at the current version, migrated the way `ui-contract migrate --write` moves it. */
function writeCurrentRepository(): void {
  writeContractRepository(root)
  migrate(root, { write: true })
}

/** An e2e test under `tests/e2e/src` that clicks an anchor the contract does not declare. */
function writeUnknownAnchorTest(): void {
  mkdirSync(join(root, TESTS), { recursive: true })
  writeFileSync(
    join(root, TESTS, 'probe.e2e.spec.ts'),
    `await page.getByTestId('${UNKNOWN_ANCHOR}').click()\n`,
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-cli-check-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    err.push(parts.join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('check --current', () => {
  it('passes a current contract that is clean, saying nothing of a version', () => {
    writeCurrentRepository()

    expect(run(['--current'])).toMatchObject({ code: 0, err: '' })
  })

  it('still reports a structural problem in a current contract, and exits 1', () => {
    writeCurrentRepository()
    rmSync(join(root, MODEL_FILE))

    const result = run(['--current'])

    expect(result.code).toBe(1)
    expect(result.err).toContain(MODEL_FILE)
  })

  it('fails an outdated contract that is otherwise clean, with the version problem', () => {
    writeContractRepository(root)

    const result = run(['--current'])

    expect(result.code).toBe(1)
    expect(result.err).toContain(VERSION_NOTE)
    expect(result.out).not.toContain(VERSION_NOTE)
  })

  it('runs the consumers check on an outdated contract too: its problems come with the version one', () => {
    writeContractRepository(root)
    writeUnknownAnchorTest()

    const plain = run(['--consumers'])
    const current = run(['--current', '--consumers'])

    expect(plain.code).toBe(1)
    expect(plain.err).toContain(UNKNOWN_ANCHOR)
    expect(current.code).toBe(1)
    expect(current.err).toContain(UNKNOWN_ANCHOR)
    expect(current.err).toContain(VERSION_NOTE)
  })
})

describe('check without --current', () => {
  it('passes an outdated contract that is otherwise clean, with the version as a note', () => {
    writeContractRepository(root)

    const result = run([])

    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.out).toContain(VERSION_NOTE)
  })
})
