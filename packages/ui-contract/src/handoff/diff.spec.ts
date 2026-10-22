import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { MODEL_FILE, SCREENS_FILE, scenarioFile, VOCABULARY_FILE } from '../files'
import { fixtureContract } from '../manifest/manifest.fixture'
import { git, repository, useRepositories, writeFiles } from '../repository.fixture'

import { contractAt, diffContracts, formatChanges } from './diff'

useRepositories()

const FIXTURES = join(import.meta.dirname, '../__fixtures__')
const SCENARIO = 'sample/base/thing'

const fixtureFiles = (): Record<string, string> => ({
  [VOCABULARY_FILE]: readFileSync(join(FIXTURES, 'vocabulary.md'), 'utf8'),
  [SCREENS_FILE]: readFileSync(join(FIXTURES, 'screens.json'), 'utf8'),
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

/** The fixture contract with one anchor renamed, one code added and one field removed. */
function changed(before: Contract): Contract {
  const after = structuredClone(before)
  const [screen] = after.screens.screens

  if (screen === undefined) {
    throw new Error('the fixture has no screen')
  }

  const { 'sample.save-button': saved, ...anchors } = screen.anchors

  if (saved === undefined) {
    throw new Error('the fixture has no sample.save-button')
  }

  screen.anchors = { ...anchors, 'sample.store-button': saved }
  after.vocabulary.codes['spare'] = { where: 'sample.error', meaning: 'a spare code' }

  const thing = after.model.entities['thing']

  if (thing === undefined) {
    throw new Error('the fixture has no thing entity')
  }

  const { title: _title, ...fields } = thing.fields

  thing.fields = fields

  return after
}

describe('diffContracts', () => {
  const before = fixtureContract()
  const after = changed(before)

  it('pairs an anchor removed and one added with the same screen and kind as a rename', () => {
    expect(diffContracts(before, after)).toEqual({
      anchors: {
        added: [],
        removed: [],
        renamed: [{ from: 'sample.save-button', to: 'sample.store-button' }],
      },
      codes: { added: ['spare'], removed: [] },
      screens: { added: [], removed: [] },
      entities: { added: [], removed: [] },
      fields: { added: [], removed: ['thing.title'] },
    })
  })
  it('leaves the anchors added and removed when the pairing is ambiguous', () => {
    const twice = structuredClone(after)
    const [screen] = twice.screens.screens
    const store = screen?.anchors['sample.store-button']

    if (screen === undefined || store === undefined) {
      throw new Error('the changed fixture lost its anchor')
    }

    screen.anchors['sample.keep-button'] = store

    expect(diffContracts(before, twice).anchors).toEqual({
      added: ['sample.keep-button', 'sample.store-button'],
      removed: ['sample.save-button'],
      renamed: [],
    })
  })
  it('takes a missing contract as an empty one', () => {
    const changes = diffContracts(undefined, before)

    expect(changes.screens.added).toEqual(['sample'])
    expect(changes.anchors.added).toEqual([
      'sample.list',
      'sample.list.row-item',
      'sample.page',
      'sample.save-button',
      'sample.sign-out-button',
      'sample.title-input',
    ])
    expect(changes.codes.added).toEqual(['failed', 'saved'])
    expect(changes.entities.added).toEqual(['thing'])
    expect(changes.fields.added).toEqual([
      'thing.author',
      'thing.created_at',
      'thing.id',
      'thing.size',
      'thing.title',
    ])
    expect(changes.anchors.removed).toEqual([])
  })
  it('finds nothing between a contract and itself', () => {
    expect(formatChanges(diffContracts(before, before))).toBe('contract changes: none')
  })
})

describe('contractAt', () => {
  it('reads the three files and the scenarios at a ref', () => {
    const contract = contractAt('HEAD', history(fixtureFiles()))

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
      [SCREENS_FILE]: (files[SCREENS_FILE] ?? '').replace('"version": 1', '"version": 2'),
    })

    expect(() => contractAt('HEAD', broken)).toThrow(
      'the contract at HEAD does not load: contract/screens.json:1: version:',
    )
  })
})

describe('formatChanges', () => {
  it('prints a summary line, then one line per list that is not empty', () => {
    const before = fixtureContract()

    expect(formatChanges(diffContracts(before, changed(before))).split('\n')).toEqual([
      'contract changes: 1 anchor renamed, 1 code added, 1 field removed',
      'anchors renamed: sample.save-button -> sample.store-button',
      'codes added: spare',
      'fields removed: thing.title',
    ])
  })
  it('counts in the plural and keeps the order screens, anchors, codes, entities, fields', () => {
    const changes = diffContracts(undefined, fixtureContract())

    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 screen added, 6 anchors added, 2 codes added, 1 entity added, 5 fields added',
      'screens added: sample',
      'anchors added: sample.list, sample.list.row-item, sample.page, sample.save-button, sample.sign-out-button, sample.title-input',
      'codes added: failed, saved',
      'entities added: thing',
      'fields added: thing.author, thing.created_at, thing.id, thing.size, thing.title',
    ])
  })
})
