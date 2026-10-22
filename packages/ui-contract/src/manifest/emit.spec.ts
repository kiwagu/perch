import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { formatProblem, SCENARIOS_DIR, SCREENS_DIR, VOCABULARY_FILE } from '../files'

import { emitManifest } from './emit'
import { REPOSITORY_ROOT } from './manifest.fixture'

let temp: string

/** The contract folder, the scenarios and the root package of the repository, under `root`. */
function copyContract(root: string): void {
  for (const path of ['contract', SCENARIOS_DIR, 'package.json']) {
    cpSync(join(REPOSITORY_ROOT, path), join(root, path), { recursive: true })
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
    const out = join(temp, 'ui-manifest')

    expect(emitManifest(REPOSITORY_ROOT, out).map(formatProblem)).toEqual([])
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

    copyContract(root)
    writeFileSync(
      vocabulary,
      readFileSync(vocabulary, 'utf8').replace(
        '| `no-notes` |',
        '| `spare` | `organisation.notes.empty-message` | a spare code |\n| `no-notes` |',
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
    const screen = join(root, SCREENS_DIR, 'sign-in.yaml')
    const search = {
      type: 'object',
      properties: { next: { type: 'string', pattern: '[' } },
      required: ['next', 'next'],
      additionalProperties: false,
    }

    copyContract(root)
    writeFileSync(
      screen,
      readFileSync(screen, 'utf8').replace(
        'history: push }',
        `history: push, search: ${JSON.stringify(search)} }`,
      ),
    )

    expect(emitManifest(root, out).map(formatProblem)).toEqual([
      expect.stringMatching(
        /^contract\/screens\/sign-in\.yaml:1: bindings\[0\]\.search: not a valid JSON Schema \(screen "user\.sign-in"\): \/required: must NOT have duplicate items/,
      ),
    ])
    expect(existsSync(out)).toBe(false)
  })
  it('writes nothing for a path parameter no value of whose schema can be built', () => {
    const root = join(temp, 'repository')
    const out = join(temp, 'ui-manifest')
    const screen = join(root, SCREENS_DIR, 'devices.yaml')
    const params = {
      type: 'object',
      properties: { device: { type: 'string', pattern: '^[a-z]+-\\d+$' } },
      additionalProperties: false,
    }

    copyContract(root)
    writeFileSync(
      screen,
      readFileSync(screen, 'utf8').replace(
        'history: push }',
        `history: push }, { path: /devices/$device, roles: [ identity ], params: ${JSON.stringify(params)} }`,
      ),
    )

    expect(emitManifest(root, out).map(formatProblem)).toEqual([
      'contract/screens/devices.yaml:1: bindings[1].params.properties.device: needs an example (no value of its schema can be built)',
    ])
    expect(existsSync(out)).toBe(false)
  })
})
