import { describe, expect, it } from 'vitest'

import { CONTRACT_VERSION } from '../anchors'
import { formatProblem } from '../files'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { outdatedProblem, versionProblems } from './version'

/**
 * The sample contract, its `platform.yaml` declaring `version` and its vocabulary saying
 * `Contract version: <line>`, or no such line when `line` is undefined.
 */
function declaring(version: number, line: number | undefined): Contract {
  const contract = sampleContract()

  contract.screens.version = version
  contract.vocabulary.version = line

  return contract
}

const printed = (contract: Contract): string[] => versionProblems(contract).map(formatProblem)

describe('versionProblems', () => {
  it('finds nothing in a contract at version 1 whose vocabulary says the version too', () => {
    expect(printed(declaring(1, 1))).toEqual([])
  })
  it('wants the vocabulary line of a contract at version 1', () => {
    expect(printed(declaring(1, undefined))).toEqual([
      'contract/vocabulary.md:1: no "Contract version: 1" line: at version 1 the vocabulary says the version too',
    ])
  })
  it('wants the vocabulary line of a contract at version 1 equal to it', () => {
    expect(printed(declaring(1, 2))).toEqual([
      'contract/vocabulary.md:1: Contract version: 2 differs from the version 1 of platform.yaml',
    ])
  })
  it('finds nothing in a contract at version 2 whose vocabulary says no version', () => {
    expect(printed(declaring(2, undefined))).toEqual([])
  })
  it('refuses the vocabulary line from version 2: the version is written once', () => {
    expect(printed(declaring(2, 2))).toEqual([
      'contract/vocabulary.md:1: Contract version: 2: from version 2 the version is written in platform.yaml alone (bun run contract:migrate --write removes the line)',
    ])
  })
  it('finds nothing in a contract at the version of this engine', () => {
    expect(printed(declaring(CONTRACT_VERSION, undefined))).toEqual([])
  })
  it('refuses a version newer than this engine reads, naming the newest it reads', () => {
    expect(printed(declaring(CONTRACT_VERSION + 1, undefined))).toEqual([
      `contract/domain/platform.yaml:1: version: ${CONTRACT_VERSION + 1} is newer than this engine, which reads up to version ${CONTRACT_VERSION}`,
    ])
  })
})

describe('outdatedProblem', () => {
  it('names a contract at a version older than this engine and the command that moves it', () => {
    const problem = outdatedProblem(declaring(1, 1))

    expect(problem === undefined ? undefined : formatProblem(problem)).toBe(
      `contract/domain/platform.yaml:1: the contract is at version 1; this engine reads up to ${CONTRACT_VERSION} (bun run contract:migrate)`,
    )
  })
  it('finds nothing to move in a contract at the version of this engine, or a newer one', () => {
    expect(outdatedProblem(declaring(CONTRACT_VERSION, undefined))).toBeUndefined()
    expect(outdatedProblem(declaring(CONTRACT_VERSION + 1, undefined))).toBeUndefined()
  })
})
