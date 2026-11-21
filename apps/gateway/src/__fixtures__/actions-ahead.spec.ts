import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadContract } from '@workspace/ui-contract'

import { actionsAhead } from './actions-ahead'

/**
 * `actionsAhead` names the platform actions a branch's contract declares before the gateway
 * serves them: in the pre-commit hook's ahead mode, those the contract declares now and did not
 * declare at the branch's merge base with `main`; outside it, none. The sample is the repository's
 * own contract committed as the base, and the contract now is that one plus a new action.
 */

const ROOT = join(import.meta.dirname, '../../../..')

const ADDED = 'probe.added'

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

/** A repository whose commit tagged `base` holds the repository's own contract. */
function sample(): string {
  const root = mkdtempSync(join(tmpdir(), 'actions-ahead-'))

  roots.push(root)

  for (const folder of ['contract', 'tests/e2e/scenarios']) {
    cpSync(join(ROOT, folder), join(root, folder), { recursive: true })
  }

  git(root, 'init', '--quiet', '--initial-branch=main')
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'base')
  git(root, 'tag', 'base')

  return root
}

/** The actions the repository's contract declares. */
function actionsOf(root: string): string[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the sample does not load: ${JSON.stringify(problems)}`)
  }

  return Object.keys(contract.screens.platform.actions)
}

const AHEAD = { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'base' }

describe('actionsAhead', () => {
  it('lets an action the base did not declare wait for its route in the ahead mode', () => {
    const root = sample()
    const declared = [...actionsOf(root), ADDED]

    expect([...actionsAhead({ declared, root, env: AHEAD })]).toEqual([ADDED])
  })

  it('never lets an action the base declared wait, in the ahead mode either', () => {
    const root = sample()
    const declared = actionsOf(root)

    expect(declared).toContain('sign-in')
    expect([...actionsAhead({ declared, root, env: AHEAD })]).toEqual([])
  })

  it.each([
    ['without the ahead mode', {}],
    ['with the ahead mode but no base', { CONTRACT_AHEAD: '1' }],
    ['with the ahead mode and an empty base', { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: '' }],
    ['with a base but the ahead mode off', { CONTRACT_AHEAD: '0', CONTRACT_AHEAD_BASE: 'base' }],
  ] as const)('lets no action wait %s', (_, env) => {
    const root = sample()
    const declared = [...actionsOf(root), ADDED]

    expect([...actionsAhead({ declared, root, env })]).toEqual([])
  })

  it('fails when the base names no commit, rather than letting every action wait', () => {
    const root = sample()

    expect(() =>
      actionsAhead({
        declared: [ADDED],
        root,
        env: { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'nowhere' },
      }),
    ).toThrow('"nowhere" names no commit')
  })
})
