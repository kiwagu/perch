import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONTRACT_VERSION } from '../anchors'
import { writeContractRepository } from '../contract-repository.fixture'
import { MODEL_FILE, migrate, PLATFORM_FILE } from '../files'

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

/** The fixture at the current version, migrated the way `ui-contract migrate --write` moves it, its work by hand done. */
function writeCurrentRepository(): void {
  writeContractRepository(root)
  migrate(root, { write: true })
  // The work the migration leaves by hand: from version 6 an action's codes are a map.
  const platform = join(root, PLATFORM_FILE)

  writeFileSync(
    platform,
    readFileSync(platform, 'utf8').replace(
      '    codes:\n      - failed\n',
      '    codes:\n      failed: the device cannot reach the server\n',
    ),
  )
}

/** A result of one string past the budget, the other form version 6 refuses. */
const LONG_RESULT = `this device signs out ${'and forgets what it held '.repeat(8).trim()}`

/**
 * The fixture migrated to the current version with the migration's work by hand left undone: the
 * action's codes still a list, and its result one string past the budget.
 */
function writeMigratedRepositoryInOlderForms(): void {
  writeContractRepository(root)
  migrate(root, { write: true })
  const platform = join(root, PLATFORM_FILE)

  writeFileSync(
    platform,
    readFileSync(platform, 'utf8').replace(
      'result: this device signs out\n',
      `result: ${LONG_RESULT}\n`,
    ),
  )
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

describe('check of a migrated contract that keeps the older forms', () => {
  it('fails on both paths, naming the list of codes and the long result', () => {
    writeMigratedRepositoryInOlderForms()

    for (const argv of [[], ['--current']]) {
      const result = run(argv)

      expect(result.code).toBe(1)
      expect(result.err).toContain('actions["sign-out"].codes')
      expect(result.err).toContain('a list of codes')
      expect(result.err).toContain('actions["sign-out"].result')
      expect(result.err).toContain(`is ${LONG_RESULT.length} characters, past its budget`)
    }
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
