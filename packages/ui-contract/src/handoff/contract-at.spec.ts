import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MODEL_FILE, PLATFORM_FILE, scenarioFile, VOCABULARY_FILE } from '../files'
import { fixtureContract } from '../manifest/manifest.fixture'
import { git, repository, useRepositories, writeFiles } from '../repository.fixture'

import { contractAt } from './contract-at'

useRepositories()

const FIXTURES = join(import.meta.dirname, '../__fixtures__')
const SCENARIO = 'sample/base/thing'
const SCREEN = 'contract/domain/screens/sample/$key.yaml'
const ACTIVITY = 'contract/domain/activities/thing.yaml'

const fixtureFiles = (): Record<string, string> => ({
  [VOCABULARY_FILE]: readFileSync(join(FIXTURES, 'vocabulary.md'), 'utf8'),
  [SCREEN]: readFileSync(join(FIXTURES, SCREEN), 'utf8'),
  [ACTIVITY]: readFileSync(join(FIXTURES, ACTIVITY), 'utf8'),
  [PLATFORM_FILE]: readFileSync(join(FIXTURES, PLATFORM_FILE), 'utf8'),
  [MODEL_FILE]: readFileSync(join(FIXTURES, 'model.schema.json'), 'utf8'),
  [scenarioFile(SCENARIO)]: readFileSync(join(FIXTURES, scenarioFile(SCENARIO)), 'utf8'),
})

/** A repository whose first commit has only a README and whose second adds `files`. */
function history(files: Readonly<Record<string, string>>): string {
  const root = repository({ 'README.md': '# sample\n' }, ['README.md'])

  git(root, 'commit', '--quiet', '-m', 'first')
  git(root, 'tag', 'first')

  writeFiles(root, files)
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'second')

  return root
}

describe('contractAt', () => {
  it('reads the contract files, the screen files, the activities and the scenarios at a ref', () => {
    const contract = contractAt('HEAD', history(fixtureFiles()))

    expect('missing' in contract ? [] : contract.activities.map(({ id }) => id)).toEqual(['thing'])
    expect(contract).toEqual(fixtureContract())
  })
  it('finds no contract at a commit without the folder', () => {
    expect(contractAt('first', history(fixtureFiles()))).toEqual({ missing: true })
  })
  it('refuses a ref that names no commit, and a contract that does not load', () => {
    const { [MODEL_FILE]: _model, ...partial } = fixtureFiles()
    const root = history(partial)

    expect(() => contractAt('nowhere', root)).toThrow('"nowhere" names no commit')
    expect(() => contractAt('HEAD', root)).toThrow(`HEAD has no ${MODEL_FILE}`)

    const files = fixtureFiles()
    const broken = history({
      ...files,
      [PLATFORM_FILE]: (files[PLATFORM_FILE] ?? '').replace('version: 1', 'version: 2'),
    })

    expect(() => contractAt('HEAD', broken)).toThrow(
      'the contract at HEAD does not load: contract/domain/platform.yaml:1: version:',
    )
  })
})
