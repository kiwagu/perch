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

import { formatProblem, VOCABULARY_FILE } from '../files'

import { emitManifest } from './emit'
import { REPOSITORY_ROOT } from './manifest.fixture'

let temp: string

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

    cpSync(join(REPOSITORY_ROOT, 'contract'), join(root, 'contract'), { recursive: true })
    cpSync(join(REPOSITORY_ROOT, 'package.json'), join(root, 'package.json'))
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
})
