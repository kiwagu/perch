import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { sampleContract } from './contract.fixture'
import { versionProblems } from './version'

const printed = (contract = sampleContract()): string[] =>
  versionProblems(contract).map(formatProblem)

describe('versionProblems', () => {
  it('finds nothing when both files carry the version of the tooling', () => {
    expect(printed()).toEqual([])
  })
  it('names each file whose version differs from the tooling', () => {
    const contract = sampleContract()

    contract.vocabulary.version = 2
    Object.assign(contract.screens, { version: 3 })

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: version: 3 differs from the contract version 1 of the tooling',
      'contract/vocabulary.md:1: Contract version: 2 differs from the contract version 1 of the tooling',
    ])
  })
})
