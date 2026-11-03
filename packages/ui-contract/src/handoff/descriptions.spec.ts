import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { sampleContract } from '../check/contract.fixture'
import type { AnchorDef } from '../files'

import { listDescriptions } from './descriptions'

/** The sample with `defs` written over the anchors of its `sample` screen. */
function writing(defs: Record<string, AnchorDef>): Contract {
  const contract = sampleContract()
  const screen = contract.screens.screens.find(({ id }) => id === 'sample')

  if (screen === undefined) {
    throw new Error('no screen')
  }

  Object.assign(screen.anchors, defs)

  return contract
}

describe('listDescriptions', () => {
  it('lists a written description the engine would say itself, and no other', () => {
    expect(
      listDescriptions(
        writing({
          'sample.page': { kind: 'heading', description: 'Names the screen `One thing`.' },
          'sample.other-heading': { kind: 'heading', description: 'The title of the thing.' },
        }),
      ),
    ).toBe(
      '1 written description(s) the engine says itself:\nsample.page: Names the screen `One thing`.',
    )
  })
  it('says so when no written description is the derived one', () => {
    expect(listDescriptions(sampleContract())).toBe('no written description the engine says itself')
  })
})
