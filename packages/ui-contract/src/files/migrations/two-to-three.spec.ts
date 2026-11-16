import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeContractRepository } from '../../contract-repository.fixture'
import { filesUnder } from '../files-under'
import { PLATFORM_FILE } from '../paths'
import { parseYamlDocument } from '../read-yaml-document'

import { migrate } from './apply'
import type { MigrationFiles } from './migration'
import { oneToTwo } from './one-to-two'
import { twoToThree } from './two-to-three'

/** The registry and the engine's version as they stood when version 3 came. */
const TO_THREE = { migrations: [oneToTwo, twoToThree], current: 3 } as const

const MANUAL = [
  'declare `values` and refer every string parameter',
  'attribute every field-shaped code',
  'write `form` or a field for each code two fields share',
  'drop written `fields` the engine derives',
]

const PLATFORM = [
  '# yaml-language-server: $schema=../schemas/platform.schema.json',
  'version: 2',
  'actions:',
  '  things.rename:',
  '    params:',
  '      name: { type: string, description: "The new name." }',
  '    codes: [ name-too-long, failed ]',
  '',
].join('\n')
const SCREEN = 'id: sample\nanchors:\n  sample.error: { kind: error }\n'
const VOCABULARY = '# Vocabulary\n\nThe closed lists of the contract.\n'

let root: string

/** Every file of the repository with its text, by its path. */
const snapshot = (): Map<string, string> =>
  new Map((filesUnder(root) ?? []).map((file) => [file, readFileSync(join(root, file), 'utf8')]))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-two-to-three-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('twoToThree', () => {
  it('steps from version 2 and edits no file, leaving the work of version 3 by hand', () => {
    const files: MigrationFiles = {
      platform: parseYamlDocument(PLATFORM),
      screens: new Map([['sample/$key.yaml', parseYamlDocument(SCREEN)]]),
      vocabulary: VOCABULARY,
      model: '',
    }

    expect(twoToThree.from).toBe(2)
    expect(twoToThree.run(files)).toEqual(MANUAL)
    expect(files.platform.toString({ lineWidth: 0 })).toBe(PLATFORM)
    expect(files.screens.get('sample/$key.yaml')?.toString({ lineWidth: 0 })).toBe(SCREEN)
    expect(files.vocabulary).toBe(VOCABULARY)
  })

  it('changes no file but the version the runner sets in platform.yaml', () => {
    writeContractRepository(root)
    migrate(root, { write: true, migrations: [oneToTwo], current: 2 })

    const atTwo = snapshot()

    expect(migrate(root, { write: true, ...TO_THREE })).toEqual({
      from: 2,
      to: 3,
      steps: [{ from: 2, note: twoToThree.note, files: [PLATFORM_FILE], manual: MANUAL }],
    })

    const atThree = snapshot()

    expect([...atThree.keys()]).toEqual([...atTwo.keys()])
    expect([...atThree].filter(([file, text]) => atTwo.get(file) !== text)).toEqual([
      [PLATFORM_FILE, atTwo.get(PLATFORM_FILE)?.replace(/^version: 2$/m, 'version: 3')],
    ])
  })
})
