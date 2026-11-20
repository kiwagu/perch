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

/** Commits the checkout as it is, an empty commit when nothing changed. */
function commitAll(root: string, message: string): void {
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '--allow-empty', '-m', message)
}

/** Commits what `change` does to the checkout on a new branch `name` cut from `base`. */
function branchFrom(root: string, base: string, name: string, change: () => void = () => {}): void {
  git(root, 'switch', '--quiet', '--create', name, base)
  change()
  commitAll(root, name)
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

/** A change that adds a file and touches nothing of the contract. */
const addNote = (root: string): void => writeFiles(root, { 'NOTES.md': 'work\n' })

/**
 * A repository whose `main` held a contract with a rule broken when each branch of `branches`
 * was cut from it, and which `main` has since moved past by fixing the rule. It is left on `main`.
 */
function staleRepository(branches: Readonly<Record<string, (root: string) => void>>): string {
  const root = repository({ 'README.md': '# sample\n' }, ['README.md'])

  git(root, 'commit', '--quiet', '-m', 'first')
  git(root, 'branch', '--move', 'main')
  writeContractRepository(root)
  breakRule(root)
  commitAll(root, 'old main')

  for (const [name, change] of Object.entries(branches)) {
    branchFrom(root, 'main', name, () => change(root))
  }

  git(root, 'switch', '--quiet', 'main')
  replace(root, SCREEN, BROKEN, BOUND)
  commitAll(root, 'main moves')

  return root
}

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
    const result = run(fixtureRepository({ 'chore/bare': addNote }, ['chore/bare']))
    const lines = result.out.split('\n')

    expect(result).toMatchObject({ code: 0, err: '' })
    expect(lines).toContain('chore/bare: no contract')
    expect(lines).toContain('contract/trunk: OK (version 1)')
  })

  it('leaves out a branch cut from main that adds nothing, its old contract not loaded', () => {
    const result = run(staleRepository({ 'feat/stale': () => {} }))

    expect(result).toMatchObject({ code: 0, err: '' })
    expect(result.out.split('\n')).toEqual([
      'feat/stale: nothing unlanded, left out',
      'inflight: 0 branches, 0 broken, 1 left out',
    ])
    expect(result.out).not.toMatch(/^(\S+): \d+ problems?$/m)
  })

  it('checks a branch that adds a change, the left out ones counted apart', () => {
    const result = run(staleRepository({ 'feat/stale': () => {}, 'fix/carries': addNote }))
    const lines = result.out.split('\n')

    expect(result.code).toBe(1)
    expect(lines).toContain('feat/stale: nothing unlanded, left out')
    expect(lines).toContain('fix/carries: 1 problem')
    expect(lines.at(-1)).toBe('inflight: 1 branch, 1 broken, 1 left out')
  })

  it('leaves out a branch at the tip of main', () => {
    const root = fixtureRepository()

    git(root, 'branch', 'feat/tip', 'main')

    const result = run(root)

    expect(result).toMatchObject({ code: 0, err: '' })
    expect(result.out.split('\n')).toEqual([
      'contract/trunk: OK (version 1)',
      'feat/tip: nothing unlanded, left out',
      'inflight: 1 branch, 0 broken, 1 left out',
    ])
  })

  it('leaves out a branch whose work main took in, then merged back', () => {
    const root = fixtureRepository({ 'feat/landed': addNote })

    git(root, 'merge', '--quiet', '--squash', 'feat/landed')
    commitAll(root, 'landed')
    git(root, 'switch', '--quiet', 'feat/landed')
    git(root, 'merge', '--quiet', '--no-ff', '--no-edit', 'main')
    git(root, 'switch', '--quiet', 'main')

    const lines = run(root).out.split('\n')

    expect(lines).toContain('feat/landed: nothing unlanded, left out')
    expect(lines.at(-1)).toBe('inflight: 1 branch, 0 broken, 1 left out')
  })

  it('checks a branch with no merge base with main, never leaving it out', () => {
    const root = fixtureRepository()

    git(root, 'switch', '--quiet', '--orphan', 'feat/orphan')
    commitAll(root, 'unrelated')
    git(root, 'switch', '--quiet', 'main')

    const lines = run(root).out.split('\n')

    expect(lines).toContain('feat/orphan: no contract')
    expect(lines.at(-1)).toBe('inflight: 2 branches, 0 broken')
  })

  it('checks a branch with several merge bases with main, never leaving it out', () => {
    const root = fixtureRepository()
    const same = (message: string): void => {
      writeFiles(root, { 'same.txt': 'same\n' })
      commitAll(root, message)
    }

    branchFrom(root, 'main', 'feat/crossed')
    git(root, 'switch', '--quiet', 'main')
    same('on main')
    git(root, 'switch', '--quiet', 'feat/crossed')
    same('on the branch')
    git(root, 'merge', '--quiet', '--no-edit', 'main')
    git(root, 'switch', '--quiet', 'main')
    git(root, 'merge', '--quiet', '--no-edit', 'feat/crossed^1')

    expect(
      read(root, ['merge-base', '--all', 'main', 'feat/crossed']).trim().split('\n'),
    ).toHaveLength(2)
    expect(read(root, ['diff', 'main...feat/crossed'])).toBe('')

    const lines = run(root).out.split('\n')

    expect(lines).toContain('feat/crossed: no contract')
    expect(lines.at(-1)).toBe('inflight: 2 branches, 0 broken')
  })

  it('checks every branch when git cannot read main, never leaving one out', () => {
    const root = fixtureRepository({ 'feat/x': () => {} })

    git(root, 'branch', '--move', 'main', 'trunkless')

    const lines = run(root).out.split('\n')

    expect(lines).toContain('feat/x: OK (version 1)')
    expect(lines.at(-1)).toBe('inflight: 2 branches, 0 broken')
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
