import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CONTRACT_VERSION } from '../anchors'
import { writeContractRepository } from '../contract-repository.fixture'
import { MODEL_FILE, PLATFORM_FILE } from '../files'
import { git as read } from '../handoff'
import { git, repository, useRepositories, writeFiles } from '../repository.fixture'

import { inflight } from './inflight'

useRepositories()

const SCREEN = 'contract/domain/screens/sample/$key.yaml'
const BOUND = 'binding: { model: thing.title }'
const BROKEN = 'binding: { model: thing.nope }'

let out: string[]
let err: string[]

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs `inflight` in the repository at `root`, capturing what it prints. */
function run(
  root: string,
  argv: readonly string[] = [],
): { code: number; out: string; err: string } {
  out = []
  err = []
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    err.push(parts.join(' '))
  })

  const code = inflight(argv)

  return { code, out: out.join('\n'), err: err.join('\n') }
}

/** Commits what `change` does to the checkout on a new branch `name` cut from `base`. */
function branchFrom(root: string, base: string, name: string, change: () => void = () => {}): void {
  git(root, 'switch', '--quiet', '--create', name, base)
  change()
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '--allow-empty', '-m', name)
}

/**
 * A repository whose `main` holds a README only and whose `contract/trunk` adds the fixture
 * contract, a whole one that passes the check at version 1 (older than the engine's). It is
 * left on `main`; each branch of `branches` is cut from the trunk, or from `main` when it says so.
 */
function fixtureRepository(
  branches: Readonly<Record<string, (root: string) => void>> = {},
  fromMain: readonly string[] = [],
): string {
  const root = repository({ 'README.md': '# sample\n' }, ['README.md'])

  git(root, 'commit', '--quiet', '-m', 'first')
  git(root, 'branch', '--move', 'main')
  branchFrom(root, 'main', 'contract/trunk', () => writeContractRepository(root))

  for (const [name, change] of Object.entries(branches)) {
    branchFrom(root, fromMain.includes(name) ? 'main' : 'contract/trunk', name, () => change(root))
  }

  git(root, 'switch', '--quiet', 'main')

  return root
}

/** Rewrites `file` in the checkout, `from` as it is there to `to`. */
function replace(root: string, file: string, from: string, to: string): void {
  writeFiles(root, { [file]: readFileSync(join(root, file), 'utf8').replace(from, to) })
}

const breakRule = (root: string): void => replace(root, SCREEN, BOUND, BROKEN)

describe('inflight', () => {
  it('prints each branch in flight with OK or its problems, and exits 1 on a break', () => {
    const root = fixtureRepository({ 'feat/breaks': breakRule, 'fix/passes': () => {} })
    const result = run(root)
    const lines = result.out.split('\n')

    expect(result.code).toBe(1)
    expect(result.err).toBe('')
    expect(lines).toContain('contract/trunk: OK (version 1)')
    expect(lines).toContain('fix/passes: OK (version 1)')

    const broken = lines.indexOf('feat/breaks: 1 problem')

    expect(broken).toBeGreaterThan(-1)
    expect(lines[broken + 1]).toMatch(/^ {2}contract\/domain\/screens\/sample\/\$key\.yaml:\d+: /)
    expect(lines[broken + 1]).toContain('entity "thing" has no field "nope"')
    expect(lines.at(-1)).toBe('inflight: 3 branches, 1 broken')
  })

  it('exits 0 when every branch passes, an older version alone being no problem', () => {
    const result = run(fixtureRepository({ 'feat/passes': () => {} }))

    expect(CONTRACT_VERSION).toBeGreaterThan(1)
    expect(result).toMatchObject({ code: 0, err: '' })
    expect(result.out).toContain('contract/trunk: OK (version 1)')
    expect(result.out).not.toContain('problem')
    expect(result.out.split('\n').at(-1)).toBe('inflight: 2 branches, 0 broken')
  })

  it('skips the branches outside the flight: main, experiment/* and the rest', () => {
    const root = fixtureRepository({
      'experiment/x': breakRule,
      'claude/y': breakRule,
      'feature/z': breakRule,
    })
    const result = run(root)

    expect(result).toMatchObject({ code: 0, err: '' })
    expect(result.out.split('\n')).toEqual([
      'contract/trunk: OK (version 1)',
      'inflight: 1 branch, 0 broken',
    ])
  })

  it('names a contract that does not load as that branch own problem, the others going on', () => {
    const root = fixtureRepository({
      'refactor/partial': (at) => git(at, 'rm', '--quiet', MODEL_FILE),
      'fix/passes': () => {},
    })
    const result = run(root)
    const lines = result.out.split('\n')

    expect(result.code).toBe(1)
    expect(lines).toContain('refactor/partial: 1 problem')
    expect(lines).toContain(`  refactor/partial has no ${MODEL_FILE}`)
    expect(lines).toContain('fix/passes: OK (version 1)')
  })

  it('breaks a branch at a version newer than the engine reads', () => {
    const root = fixtureRepository({
      'feat/ahead': (at) =>
        replace(at, PLATFORM_FILE, 'version: 1', `version: ${CONTRACT_VERSION + 1}`),
    })
    const result = run(root)

    expect(result.code).toBe(1)
    expect(result.out).toContain('feat/ahead: ')
    expect(result.out).toContain(`${CONTRACT_VERSION + 1} is newer than this engine`)
  })

  it('does not count a branch with no contract as a break', () => {
    const result = run(fixtureRepository({ 'chore/bare': () => {} }, ['chore/bare']))
    const lines = result.out.split('\n')

    expect(result).toMatchObject({ code: 0, err: '' })
    expect(lines).toContain('chore/bare: no contract')
    expect(lines).toContain('contract/trunk: OK (version 1)')
  })

  it('reads the refs only: the checkout, the index and every branch stay as they were', () => {
    const root = fixtureRepository({ 'feat/breaks': breakRule })
    const state = (): string =>
      [
        read(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
        read(root, ['status', '--porcelain', '--ignored']),
        read(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
        read(root, ['stash', 'list']),
      ].join('\n---\n')
    const before = state()

    expect(run(root).code).toBe(1)
    expect(state()).toBe(before)
  })

  it('says no branch is in flight when none is, and is no failure', () => {
    const root = repository({ 'README.md': '# sample\n' }, ['README.md'])

    git(root, 'commit', '--quiet', '-m', 'first')
    git(root, 'branch', '--move', 'main')

    expect(run(root)).toEqual({ code: 0, out: 'inflight: no branch in flight', err: '' })
  })

  it('takes no argument', () => {
    const result = run(fixtureRepository(), ['feat/x'])

    expect(result.code).toBe(1)
    expect(result.err).toBe('ui-contract: use "inflight"')
    expect(result.out).toBe('')
  })
})
