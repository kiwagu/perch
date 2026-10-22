import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadModel } from './model'
import { VOCABULARY_FILE } from './paths'
import { formatProblem, type Problem } from './problems'
import { loadScenarios } from './scenarios'
import { loadScreens } from './screens'
import { parseVocabulary } from './vocabulary'

const ROOT = join(import.meta.dirname, '../../../..')

const KINDS = [
  'button',
  'link',
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menu',
  'nav',
  'item',
  'option',
  'row',
  'cell',
  'card',
  'table',
  'list',
  'form',
  'dialog',
  'panel',
  'section',
  'page',
  'heading',
  'message',
  'error',
  'toast',
  'badge',
  'status',
]

const printed = (problems: readonly Problem[]): string[] => problems.map(formatProblem)

/** The vocabulary of the repository's contract folder, read with problems on failure. */
function readVocabulary(): ReturnType<typeof parseVocabulary> {
  let markdown: string

  try {
    markdown = readFileSync(join(ROOT, VOCABULARY_FILE), 'utf8')
  } catch {
    return {
      ...parseVocabulary(''),
      problems: [{ file: VOCABULARY_FILE, message: 'cannot read the file' }],
    }
  }

  return parseVocabulary(markdown)
}

describe('the contract folder of the repository', () => {
  it('has a vocabulary without problems, with the closed list of kinds', () => {
    const { vocabulary, problems } = readVocabulary()

    expect(printed(problems)).toEqual([])
    expect(vocabulary.version).toBe(1)
    expect(Object.keys(vocabulary.kinds)).toEqual(KINDS)
  })
  it('has the screens of the application without problems', () => {
    const { screens, problems } = loadScreens(ROOT)

    expect(printed(problems)).toEqual([])
    expect(screens?.screens.map((screen) => screen.id)).toEqual([
      'app-shell',
      'user.sign-in',
      'user.profile',
      'organisation',
      'device',
    ])
  })
  it('has the scenarios without problems, sorted by their paths', () => {
    const { scenarios, problems } = loadScenarios(ROOT)

    expect(printed(problems)).toEqual([])
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'contract/base/manifest',
      'device/base/my-devices',
      'organisation/flows/edit-own-admin-any',
      'organisation/flows/membership-change',
      'organisation/flows/outsider',
      'organisation/flows/shared-notes',
      'user/base/blocked-storage',
      'user/base/edit-profile-name',
      'user/base/sign-up',
      'user/base/unopenable-database',
      'user/flows/blocked-delete',
      'user/flows/idle-traffic',
      'user/flows/key-renewal',
      'user/flows/offline-edit',
      'user/flows/one-account-per-browser',
      'user/flows/one-leader-per-browser',
      'user/flows/sign-out',
      'user/flows/two-devices',
    ])
  })
  it('has the data model without problems, with its two entities', () => {
    const { model, problems } = loadModel(ROOT)

    expect(printed(problems)).toEqual([])
    expect(Object.keys(model?.entities ?? {}).sort()).toEqual(['note', 'profile'])
  })
})
