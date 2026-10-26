import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeContractRepository } from '../contract-repository.fixture'
import { formatProblem, SCREENS_DIR, VOCABULARY_FILE } from '../files'

import { emitManifest } from './emit'

let temp: string

/** The fixture repository under `root`, its sample screen changed by `change` when given. */
function repositoryAt(root: string, change?: (screen: string) => string): void {
  writeContractRepository(root)

  if (change !== undefined) {
    const screen = join(root, SCREENS_DIR, 'sample/$key.yaml')

    writeFileSync(screen, change(readFileSync(screen, 'utf8')))
  }
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'ui-contract-emit-'))
})

afterEach(() => {
  rmSync(temp, { recursive: true, force: true })
})

describe('emitManifest', () => {
  it('writes the manifest of a contract that passes the check', () => {
    const root = join(temp, 'repository')
    const out = join(temp, 'ui-manifest')

    repositoryAt(root)

    expect(emitManifest(root, out).map(formatProblem)).toEqual([])
    expect(readdirSync(out).sort()).toEqual([
      'manifest.json',
      'manifest.schema.json',
      'model.schema.json',
    ])
  })
  it('writes nothing for a contract whose files load but fail the cross-file checks', () => {
    const root = join(temp, 'repository')
    const out = join(temp, 'ui-manifest')
    const vocabulary = join(root, VOCABULARY_FILE)

    repositoryAt(root)
    writeFileSync(
      vocabulary,
      readFileSync(vocabulary, 'utf8').replace(
        '| `saved` |',
        '| `spare` | `sample.save-button` | a spare code |\n| `saved` |',
      ),
    )

    expect(emitManifest(root, out).map(formatProblem)).toEqual([
      'contract/vocabulary.md:1: code "spare" is documented but unused',
    ])
    expect(existsSync(out)).toBe(false)
  })
  it('writes nothing for a route schema that is not a valid JSON Schema', () => {
    const root = join(temp, 'repository')
    const out = join(temp, 'ui-manifest')
    const search = {
      type: 'object',
      properties: { next: { type: 'string', pattern: '[' } },
      required: ['next', 'next'],
      additionalProperties: false,
    }

    repositoryAt(root, (screen) =>
      screen.replace(
        'additionalProperties: false } } ]',
        `additionalProperties: false }, search: ${JSON.stringify(search)} } ]`,
      ),
    )

    expect(emitManifest(root, out).map(formatProblem)).toEqual([
      expect.stringMatching(
        /^contract\/domain\/screens\/sample\/\$key\.yaml:1: bindings\[0\]\.search: not a valid JSON Schema \(screen "sample"\): \/required: must NOT have duplicate items/,
      ),
    ])
    expect(existsSync(out)).toBe(false)
  })
  it('writes nothing for a path parameter no value of whose schema can be built', () => {
    const root = join(temp, 'repository')
    const out = join(temp, 'ui-manifest')
    const key = { type: 'string', pattern: '^[a-z]+-\\d+$' }

    repositoryAt(root, (screen) =>
      screen.replace('{ type: string, examples: [ thg_01hzx9k2 ] }', JSON.stringify(key)),
    )

    expect(emitManifest(root, out).map(formatProblem)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: bindings[0].params.properties.key: needs an example (no value of its schema can be built)',
    ])
    expect(existsSync(out)).toBe(false)
  })
})
