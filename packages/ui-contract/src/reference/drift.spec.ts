import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeContractRepository } from '../contract-repository.fixture'
import { REFERENCE_FILE } from '../files'

import { referenceDrift } from './drift'
import { renderReference } from './render'

let root: string

const path = (): string => join(root, REFERENCE_FILE)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-reference-'))
  writeContractRepository(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('referenceDrift', () => {
  it('names a missing reference', () => {
    rmSync(path())

    expect(referenceDrift(root)).toEqual([
      { file: 'contract/REFERENCE.md', message: 'is missing; run `bun run contract:schemas`' },
    ])
  })
  it('names a reference whose content changed by one byte', () => {
    const text = readFileSync(path(), 'utf8')

    writeFileSync(path(), `${text}\n`)

    expect(referenceDrift(root)).toEqual([
      {
        file: 'contract/REFERENCE.md',
        message: "differs from the engine's schemas; run `bun run contract:schemas`",
      },
    ])
  })
  it('is empty for the text the engine renders', () => {
    writeFileSync(path(), renderReference())

    expect(referenceDrift(root)).toEqual([])
  })
})
