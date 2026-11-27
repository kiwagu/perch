import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadContract, MODEL_FILE } from '@workspace/ui-contract'

import { type DeclaredEntity, entitiesAhead } from './entities-ahead'

/**
 * `entitiesAhead` names the entities a branch's model declares before the schema stores them: in
 * the pre-commit hook's ahead mode, those the model declares now and did not declare at the
 * branch's merge base with `main`, while the schema defines no table of theirs; outside it, none.
 * The sample is the repository's own contract committed as the base, and the model now is that
 * one plus a new entity.
 */

const ROOT = join(import.meta.dirname, '../../..')

const ADDED: DeclaredEntity = { name: 'probe_added', table: 'probe_added_rows' }

/** No table of the schema yet: the added entity's table is not among them. */
const NONE_STORED: ReadonlySet<string> = new Set()

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

/**
 * A repository whose commit tagged `bare` has no contract, and whose next commit, tagged `base`,
 * holds the repository's own contract.
 */
function sample(): string {
  const root = mkdtempSync(join(tmpdir(), 'entities-ahead-'))

  roots.push(root)
  git(root, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(root, 'README.md'), 'A repository before its contract.\n')
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'bare')
  git(root, 'tag', 'bare')

  for (const folder of ['contract', 'tests/e2e/scenarios']) {
    cpSync(join(ROOT, folder), join(root, folder), { recursive: true })
  }

  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'base')
  git(root, 'tag', 'base')

  return root
}

/** Commits a model that does not load on top of `root`'s history and tags it `broken`. */
function breakModel(root: string): void {
  writeFileSync(join(root, MODEL_FILE), '{ not json')
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'broken')
  git(root, 'tag', 'broken')
}

/** The entities the repository's model declares. */
function entitiesOf(root: string): DeclaredEntity[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the sample does not load: ${JSON.stringify(problems)}`)
  }

  return Object.values(contract.model.entities)
}

const namesOf = (entities: ReadonlySet<string>): string[] => [...entities]

const AHEAD = { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'base' }

describe('entitiesAhead', () => {
  it('lets an entity the base did not declare wait for its table in the ahead mode', () => {
    const root = sample()
    const declared = [...entitiesOf(root), ADDED]

    expect(namesOf(entitiesAhead({ declared, stored: NONE_STORED, root, env: AHEAD }))).toEqual([
      ADDED.name,
    ])
  })

  it('holds an entity the base did not declare once the schema defines its table', () => {
    const root = sample()
    const declared = [...entitiesOf(root), ADDED]
    const stored = new Set([ADDED.table])

    expect(namesOf(entitiesAhead({ declared, stored, root, env: AHEAD }))).toEqual([])
  })

  it('never lets an entity the base declared wait, in the ahead mode either', () => {
    const root = sample()
    const declared = entitiesOf(root)

    expect(declared.length).toBeGreaterThan(0)
    expect(namesOf(entitiesAhead({ declared, stored: NONE_STORED, root, env: AHEAD }))).toEqual([])
  })

  it('lets every entity wait for its table when the base has no contract yet', () => {
    const root = sample()
    const declared = [...entitiesOf(root), ADDED]
    const env = { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'bare' }

    expect(namesOf(entitiesAhead({ declared, stored: NONE_STORED, root, env }))).toEqual(
      declared.map((entity) => entity.name),
    )
  })

  it.each([
    ['without the ahead mode', {}],
    ['with the ahead mode but no base', { CONTRACT_AHEAD: '1' }],
    ['with the ahead mode and an empty base', { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: '' }],
    ['with a base but the ahead mode off', { CONTRACT_AHEAD: '0', CONTRACT_AHEAD_BASE: 'base' }],
  ] as const)('lets no entity wait %s', (_, env) => {
    const root = sample()
    const declared = [...entitiesOf(root), ADDED]

    expect(namesOf(entitiesAhead({ declared, stored: NONE_STORED, root, env }))).toEqual([])
  })

  it('fails when the base names no commit, rather than letting every entity wait', () => {
    const root = sample()

    expect(() =>
      entitiesAhead({
        declared: [ADDED],
        stored: NONE_STORED,
        root,
        env: { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'nowhere' },
      }),
    ).toThrow('"nowhere" names no commit')
  })

  it("fails when the base's contract does not load, rather than letting every entity wait", () => {
    const root = sample()

    breakModel(root)

    expect(() =>
      entitiesAhead({
        declared: [ADDED],
        stored: NONE_STORED,
        root,
        env: { CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'broken' },
      }),
    ).toThrow('the contract at broken does not load')
  })
})
