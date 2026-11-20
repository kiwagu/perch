import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  contractAt,
  DOMAIN_DIR,
  loadContract,
  PLATFORM_FILE,
  SCENARIOS_DIR,
  VOCABULARY_FILE,
  valuesModuleOf,
} from '@workspace/ui-contract'

import { heldModule } from './emitted-module.fixture'

/**
 * `heldModule` holds a generated module to the contract of the working tree, or, while the
 * contract runs ahead of the app, to the contract at the branch's merge base with `main` or at the
 * commit the branch is at. The repository is this one's contract in three states: a base commit,
 * a head commit that raises a limit, and a working tree that raises it again, so each state emits
 * another module; a commit before them holds no contract.
 */

const ROOT = join(import.meta.dirname, '../../..')

interface Repository {
  readonly root: string
  readonly first: string
  readonly base: string
  readonly head: string
}

/** The first limit `platform.yaml` writes, raised by `by`: every state emits another module. */
const raised = (platform: string, by: number): string =>
  platform.replace(/maxLength: (\d+)/, (_, limit: string) => `maxLength: ${Number(limit) + by}`)

/** What `git <args>` prints in `root`, run without the `GIT_*` variables of a hook. */
function git(root: string, ...args: string[]): string {
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid']
  const inherited = Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))

  const quiet = ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']

  return execFileSync('git', [...identity, ...quiet, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: Object.fromEntries(inherited),
  }).trim()
}

function commit(root: string, message: string): string {
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '--allow-empty', '-m', message)

  return git(root, 'rev-parse', 'HEAD')
}

/**
 * The path of one scenario file: the contract loads with one, and `contractAt` reads a git file
 * at a time, so the repository holds no more.
 */
function oneScenario(): string {
  const found = readdirSync(join(ROOT, SCENARIOS_DIR), { recursive: true, encoding: 'utf8' }).find(
    (file) => file.endsWith('.md'),
  )

  if (found === undefined) {
    throw new Error(`${SCENARIOS_DIR} holds no scenario to copy`)
  }

  return join(SCENARIOS_DIR, found)
}

function repositoryOfTheContract(): Repository {
  const root = mkdtempSync(join(tmpdir(), 'kernel-emitted-module-'))

  git(root, 'init', '--quiet')

  const first = commit(root, 'first')

  for (const path of [VOCABULARY_FILE, DOMAIN_DIR, oneScenario()]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(ROOT, path), join(root, path), { recursive: true })
  }

  const platform = readFileSync(join(root, PLATFORM_FILE), 'utf8')
  const base = commit(root, 'base')

  writeFileSync(join(root, PLATFORM_FILE), raised(platform, 1))

  const head = commit(root, 'head')

  writeFileSync(join(root, PLATFORM_FILE), raised(platform, 2))

  return { root, first, base, head }
}

/** The module of the contract at `revision`, which the repository holds. */
function moduleAt(revision: string, root: string): string {
  const contract = contractAt(revision, root)

  if ('missing' in contract) {
    throw new Error(`${revision} holds no contract`)
  }

  return valuesModuleOf(contract)
}

/** The module of the contract of the working tree in `root`. */
function moduleNow(root: string): string {
  const { contract } = loadContract(root)

  if (contract === undefined) {
    throw new Error('the contract of the working tree does not load')
  }

  return valuesModuleOf(contract)
}

describe('the module a generated file is held to', { timeout: 30_000 }, () => {
  let repository: Repository
  let atBase: string
  let atHead: string
  let now: string

  const held = (committed: string, variables: Record<string, string | undefined>): string =>
    heldModule(valuesModuleOf, repository.root, committed, variables)

  const ahead = (): Record<string, string> => ({
    CONTRACT_AHEAD: '1',
    CONTRACT_AHEAD_BASE: repository.base,
    CONTRACT_AHEAD_HEAD: repository.head,
  })

  beforeAll(() => {
    for (const name of Object.keys(process.env).filter((each) => each.startsWith('GIT_'))) {
      vi.stubEnv(name, undefined)
    }

    repository = repositoryOfTheContract()
    atBase = moduleAt(repository.base, repository.root)
    atHead = moduleAt(repository.head, repository.root)
    now = moduleNow(repository.root)
  }, 60_000)

  afterAll(() => {
    vi.unstubAllEnvs()
    rmSync(repository.root, { recursive: true, force: true })
  })

  it('emits another module at each state of the repository', () => {
    expect(new Set([atBase, atHead, now]).size).toBe(3)
  })

  describe('without the ahead mode', () => {
    it('is what the contract of the working tree emits', () => {
      expect(held(now, {})).toBe(now)
      expect(held(atHead, {})).toBe(now)
      expect(held(atHead, {})).not.toBe(atHead)
    })

    it('ignores the revisions while the mode is not set', () => {
      const { CONTRACT_AHEAD: _mode, ...revisions } = ahead()

      expect(held(atBase, revisions)).toBe(now)
      expect(held(atBase, { ...revisions, CONTRACT_AHEAD: '0' })).toBe(now)
    })
  })

  describe('in the ahead mode', () => {
    it.each([
      ['the working tree', () => now],
      ['the base', () => atBase],
      ['the head', () => atHead],
    ])('takes a module of %s as it is', (_, module) => {
      expect(held(module(), ahead())).toBe(module())
    })

    it('holds a module no contract of the three emitted to the working tree', () => {
      const stale = `${atBase}// edited by hand\n`

      expect(held(stale, ahead())).toBe(now)
      expect(held(stale, ahead())).not.toBe(stale)
    })

    it('takes nothing from a revision that is not named', () => {
      const headOnly = { ...ahead(), CONTRACT_AHEAD_BASE: '' }

      expect(held(atBase, headOnly)).toBe(now)
      expect(held(atHead, headOnly)).toBe(atHead)
    })

    it('takes nothing from a commit that holds no contract', () => {
      const none = { ...ahead(), CONTRACT_AHEAD_BASE: repository.first }

      expect(held(atBase, none)).toBe(now)
      expect(held(atHead, none)).toBe(atHead)
    })

    it('names a base that is no commit, unless the module is the one of the working tree', () => {
      const lost = { ...ahead(), CONTRACT_AHEAD_BASE: 'nowhere' }

      expect(() => held(atHead, lost)).toThrow('"nowhere" names no commit')
      expect(held(now, lost)).toBe(now)
    })
  })
})
