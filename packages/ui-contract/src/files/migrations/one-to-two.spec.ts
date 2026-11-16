import { describe, expect, it } from 'vitest'

import { parseYamlDocument } from '../read-yaml-document'

import type { MigrationFiles } from './migration'
import { oneToTwo } from './one-to-two'

const PLATFORM = [
  '# yaml-language-server: $schema=../schemas/platform.schema.json',
  'version: 1',
  'reserved:',
  '  - sample.status',
  '',
].join('\n')

const BODY = 'The closed lists of the contract.\n\n## Grammar\n\nAn anchor names an element.\n'

const filesOf = (vocabulary: string): MigrationFiles => ({
  platform: parseYamlDocument(PLATFORM),
  screens: new Map(),
  vocabulary,
  model: '',
})

describe('oneToTwo', () => {
  it('steps from version 1', () => {
    expect(oneToTwo.from).toBe(1)
  })
  it('removes the vocabulary line and the blank line after it, leaving nothing by hand', () => {
    const files = filesOf(`# Vocabulary\n\nContract version: 1\n\n${BODY}`)

    expect(oneToTwo.run(files)).toEqual([])
    expect(files.vocabulary).toBe(`# Vocabulary\n\n${BODY}`)
  })
  it('keeps the schema comment on the first line of the platform file', () => {
    const files = filesOf(`# Vocabulary\n\nContract version: 1\n\n${BODY}`)

    oneToTwo.run(files)

    expect(files.platform.toString({ lineWidth: 0 })).toBe(PLATFORM)
  })
  it('removes a line that text follows at once, and no more', () => {
    const files = filesOf(`# Vocabulary\n\nContract version: 1\n${BODY}`)

    oneToTwo.run(files)

    expect(files.vocabulary).toBe(`# Vocabulary\n\n${BODY}`)
  })
  it('leaves a vocabulary without the line as it is', () => {
    const files = filesOf(`# Vocabulary\n\n${BODY}`)

    expect(oneToTwo.run(files)).toEqual([])
    expect(files.vocabulary).toBe(`# Vocabulary\n\n${BODY}`)
  })
})
