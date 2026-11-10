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
  'confirmation',
  'panel',
  'section',
  'page',
  'heading',
  'message',
  'range',
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
  it('has the screens of the application without problems, sorted by their files', () => {
    const { screens, problems } = loadScreens(ROOT)
    const files = screens?.files ?? []

    expect(printed(problems)).toEqual([])
    expect(files).toEqual([...files].sort())
    expect(files).toContain('contract/domain/screens/__root.yaml')
    expect(screens?.screens.map((screen) => screen.id)).toHaveLength(files.length)
    // The frame by its flag: a file named for a splat route (`$.yaml`) sorts before `__root.yaml`.
    expect(screens?.screens.find((screen) => screen.frame === true)?.id).toBe('app-shell')
  })
  it('has the scenarios without problems, sorted by their ids', () => {
    const { scenarios, problems } = loadScenarios(ROOT)
    const ids = scenarios.map((scenario) => scenario.id)

    expect(printed(problems)).toEqual([])
    expect(ids).toEqual([...ids].sort())
    expect(ids.length).toBeGreaterThan(0)
  })
  it('has the data model without problems, with the profile among its entities', () => {
    const { model, problems } = loadModel(ROOT)

    expect(printed(problems)).toEqual([])
    expect(Object.keys(model?.entities ?? {})).toContain('profile')
  })
})
