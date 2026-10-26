import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { MODEL_FILE, PLATFORM_FILE, scenarioFile, VOCABULARY_FILE } from '../files'
import { fixtureContract } from '../manifest/manifest.fixture'
import { git, repository, useRepositories, writeFiles } from '../repository.fixture'

import { contractAt, diffContracts, formatChanges } from './diff'

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

/** A visit to the sample screen, as each state of the fixture's activity is. */
const atSample = () => ({ screen: 'sample', address: { path: '/sample/$key' } })

/**
 * The fixture contract with a second activity, `gone` before the change and `invite` after
 * it; after it, `thing` also saves on the title input and leads back from `saved`.
 */
function withActivities(base: Contract, side: 'before' | 'after'): Contract {
  const contract = structuredClone(base)
  const [thing] = contract.activities

  if (thing === undefined) {
    throw new Error('the fixture has no activity')
  }

  contract.activities.push({ ...structuredClone(thing), id: side === 'before' ? 'gone' : 'invite' })

  if (side === 'after') {
    thing.states = {
      editing: {
        meta: atSample(),
        on: {
          'sample.title-input': [{ guard: 'titleGiven', target: 'saved' }, { target: 'saved' }],
        },
      },
      saved: { meta: atSample(), on: { 'sample.page': { target: 'editing' } } },
    }
  }

  return contract
}

const ACTIVITY_CHANGES = {
  added: ['invite'],
  removed: ['gone'],
  transitions: {
    thing: {
      added: ['editing on sample.title-input -> saved', 'saved on sample.page -> editing'],
      removed: ['editing on sample.save-button -> saved'],
    },
  },
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
      anchorCodes: { added: [], removed: [] },
      errorFields: { added: [], removed: [] },
      screens: { added: [], removed: [] },
      entities: { added: [], removed: [] },
      fields: { added: [], removed: ['thing.title'] },
      activities: {
        added: [],
        removed: [],
        transitions: { thing: { added: [], removed: [] } },
      },
    })
  })
  it('lists the codes and the error fields gained or lost by the anchors both contracts hold', () => {
    const more = structuredClone(after)
    const screen = more.screens.screens[0]

    if (screen === undefined) {
      throw new Error('the fixture has no screen')
    }

    screen.anchors['sample.store-button'] = {
      ...screen.anchors['sample.store-button'],
      kind: 'button',
      codes: ['saved', 'spare'],
    }
    screen.anchors['sample.title-error'] = { kind: 'error', codes: ['spare'] }
    screen.anchors['sample.page'] = {
      ...screen.anchors['sample.page'],
      kind: 'page',
      fields: { spare: 'sample.title-input' },
    }

    const changes = diffContracts(before, more)

    expect(changes.anchorCodes).toEqual({
      added: ['sample.store-button spare'],
      removed: ['sample.store-button failed'],
    })
    expect(changes.errorFields).toEqual({
      added: ['sample.page spare -> sample.title-input'],
      removed: [],
    })
    expect(formatChanges(changes)).toContain('anchor codes added: sample.store-button spare')
  })
  it('lists the activities added and removed, and the transitions changed in each on both sides', () => {
    expect(
      diffContracts(withActivities(before, 'before'), withActivities(before, 'after')).activities,
    ).toEqual(ACTIVITY_CHANGES)
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
    expect(changes.activities).toEqual({ added: ['thing'], removed: [], transitions: {} })
  })
  it('finds nothing between a contract and itself', () => {
    expect(formatChanges(diffContracts(before, before))).toBe('contract changes: none')
  })
})

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
  it('counts in the plural and keeps the order screens, anchors, codes, entities, fields, activities', () => {
    const changes = diffContracts(undefined, fixtureContract())

    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 screen added, 6 anchors added, 2 codes added, 1 entity added, 5 fields added, 1 activity added',
      'screens added: sample',
      'anchors added: sample.list, sample.list.row-item, sample.page, sample.save-button, sample.sign-out-button, sample.title-input',
      'codes added: failed, saved',
      'entities added: thing',
      'fields added: thing.author, thing.created_at, thing.id, thing.size, thing.title',
      'activities added: thing',
    ])
  })
  it('prints the activities added and removed, then the transitions changed in each', () => {
    const before = fixtureContract()
    const changes = diffContracts(withActivities(before, 'before'), withActivities(before, 'after'))

    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 activity added, 1 activity removed, 2 transitions added in thing, 1 transition removed in thing',
      'activities added: invite',
      'activities removed: gone',
      'transitions added in thing: editing on sample.title-input -> saved, saved on sample.page -> editing',
      'transitions removed in thing: editing on sample.save-button -> saved',
    ])
  })
})
