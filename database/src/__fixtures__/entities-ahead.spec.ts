import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadContract } from '@workspace/ui-contract'

import { entitiesAhead } from './entities-ahead'

/**
 * `entitiesAhead` names the entities a branch's model declares before the schema stores them: in
 * the pre-commit hook's ahead mode, those the model declares now and did not declare at the
 * branch's merge base with `main`; outside it, none. The sample is the repository's own contract
 * committed as the base, and the model now is that one plus a new entity.
 */

const ROOT = join(import.meta.dirname, '../../..')

const ADDED = 'probe_added'

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
  const root = mkdtempSync(join(tmpdir(), 'entities-ahead-'))

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

/** The entities the repository's model declares. */
function entitiesOf(root: string): string[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the sample does not load: ${JSON.stringify(problems)}`)
  }

  return Object.keys(contract.model.entities)
}

const AHEAD = { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'base' }

describe('entitiesAhead', () => {
  it('lets an entity the base did not declare wait for its table in the ahead mode', () => {
    const root = sample()
    const declared = [...entitiesOf(root), ADDED]

    expect([...entitiesAhead({ declared, root, env: AHEAD })]).toEqual([ADDED])
  })

  it('never lets an entity the base declared wait, in the ahead mode either', () => {
    const root = sample()
    const declared = entitiesOf(root)

    expect(declared.length).toBeGreaterThan(0)
    expect([...entitiesAhead({ declared, root, env: AHEAD })]).toEqual([])
  })

  it.each([
    ['without the ahead mode', {}],
    ['with the ahead mode but no base', { CONTRACT_AHEAD: '1' }],
    ['with the ahead mode and an empty base', { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: '' }],
    ['with a base but the ahead mode off', { CONTRACT_AHEAD: '0', CONTRACT_AHEAD_BASE: 'base' }],
  ] as const)('lets no entity wait %s', (_, env) => {
    const root = sample()
    const declared = [...entitiesOf(root), ADDED]

    expect([...entitiesAhead({ declared, root, env })]).toEqual([])
  })

  it('fails when the base names no commit, rather than letting every entity wait', () => {
    const root = sample()

    expect(() =>
      entitiesAhead({
        declared: [ADDED],
        root,
        env: { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'nowhere' },
      }),
    ).toThrow('"nowhere" names no commit')
  })
})
