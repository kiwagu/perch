import { describe, expect, it } from 'vitest'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { editionOf, since } from './editions'

/** The sample contract, its `platform.yaml` declaring `version`. */
function declaring(version: number): Contract {
  const contract = sampleContract()

  contract.screens.version = version

  return contract
}

describe('editionOf', () => {
  it('reads a contract by the version its platform declares', () => {
    expect(editionOf(declaring(1))).toBe(1)
    expect(editionOf(declaring(2))).toBe(2)
  })
})

describe('since', () => {
  it('applies the rules of the contract version and of every older one', () => {
    expect(since(declaring(2), 2)).toBe(true)
    expect(since(declaring(2), 1)).toBe(true)
    expect(since(declaring(1), 1)).toBe(true)
  })
  it('never applies a rule of a later version', () => {
    expect(since(declaring(1), 2)).toBe(false)
    expect(since(declaring(2), 3)).toBe(false)
  })
})
