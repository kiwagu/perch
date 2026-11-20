import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type Contract,
  loadContract,
  PLATFORM_FILE,
  resolveValue,
  valuesModuleOf,
} from '@workspace/ui-contract'

import { heldContract } from './held-contract'

/**
 * `heldContract` is the contract the gateway's bounds were taken from: the contract of the working
 * tree, or, in the pre-commit hook's ahead mode, the contract at the branch's merge base with
 * `main` or at the commit the branch is at, whichever the kernel's generated values were emitted
 * from, so a business commit that changes a bound does not fail the platform spec before the
 * implementation follows. The sample is the repository's own contract in three states: a base
 * commit, a head commit that raises the default length, and a working tree that raises it again,
 * so each state emits other values and gives an organisation's name another bound.
 */

const ROOT = join(import.meta.dirname, '../../../..')

const DEFAULT_LENGTH = /^defaults: \{ maxLength: \d+ \}$/m

const roots: string[] = []

const isGitVariable = (name: string): boolean => name.startsWith('GIT_')

// Inside a git hook `GIT_DIR` and `GIT_INDEX_FILE` name the real repository, which the engine's
// reads of a ref would take for the sample.
beforeEach(() => {
  for (const name of Object.keys(process.env).filter(isGitVariable)) {
    vi.stubEnv(name, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(root: string, ...args: string[]): void {
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid']

  execFileSync('git', [...identity, ...args], { cwd: root, stdio: 'ignore', env: process.env })
}

function contractOf(root: string): Contract {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the sample does not load: ${JSON.stringify(problems)}`)
  }

  return contract
}

/** Writes the default length the platform declares, which an organisation's name takes. */
function raiseDefaultTo(root: string, length: number): void {
  const file = join(root, PLATFORM_FILE)
  const text = readFileSync(file, 'utf8')

  if (!DEFAULT_LENGTH.test(text)) {
    throw new Error(`${PLATFORM_FILE} does not write a default length to raise`)
  }

  writeFileSync(file, text.replace(DEFAULT_LENGTH, `defaults: { maxLength: ${length} }`))
}

/** The bound of an organisation's name in `contract`. */
const nameBound = (contract: Contract): number | undefined =>
  resolveValue('organisation-name', contract.screens.platform, contract.model)?.maxLength

interface Sample {
  readonly root: string
  /** The values the kernel would hold when emitted from each state. */
  readonly values: { readonly base: string; readonly head: string; readonly now: string }
}

function sample(): Sample {
  const root = mkdtempSync(join(tmpdir(), 'held-contract-'))

  roots.push(root)

  for (const folder of ['contract', 'tests/e2e/scenarios']) {
    cpSync(join(ROOT, folder), join(root, folder), { recursive: true })
  }

  git(root, 'init', '--quiet', '--initial-branch=main')

  const commit = (name: string, length: number): string => {
    raiseDefaultTo(root, length)

    const values = valuesModuleOf(contractOf(root))

    git(root, 'add', '--all')
    git(root, 'commit', '--quiet', '-m', name)
    git(root, 'tag', name)

    return values
  }

  const base = commit('base', 80)
  const head = commit('head', 81)

  raiseDefaultTo(root, 82)

  return { root, values: { base, head, now: valuesModuleOf(contractOf(root)) } }
}

const AHEAD = { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'base', CONTRACT_AHEAD_HEAD: 'head' }

describe('heldContract', () => {
  it('is the contract of the working tree, whatever values the kernel holds, without the ahead mode', () => {
    const { root, values } = sample()

    for (const committed of [values.base, values.head, values.now]) {
      expect(nameBound(heldContract({ committed, root, env: {} }))).toBe(82)
    }
  })

  it.each([
    ['the working tree', 'now', 82],
    ['the base', 'base', 80],
    ['the head', 'head', 81],
  ] as const)(
    'is the contract of %s in the ahead mode when the values were emitted from it',
    (_, state, bound) => {
      const { root, values } = sample()
      const held = heldContract({ committed: values[state], root, env: AHEAD })

      expect(nameBound(held)).toBe(bound)
      expect(valuesModuleOf(held)).toBe(values[state])
    },
  )

  it('is the contract of the working tree in the ahead mode when the values are none of theirs', () => {
    const { root, values } = sample()
    const edited = `${values.base}// edited by hand\n`

    expect(nameBound(heldContract({ committed: edited, root, env: AHEAD }))).toBe(82)
  })
})
