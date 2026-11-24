import { describe, expect, it } from 'vitest'

import { sampleContract, screenIn } from '../check/contract.fixture'

import { sourceLines } from './source-lines'

describe('sourceLines', () => {
  it('says each list that reads a platform action, its params by name and whether it pages', () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.accounts-list': {
        kind: 'list',
        source: {
          platform: 'accounts.list',
          params: { q: { search: 'q' }, kind: { value: 'all' }, limit: { value: 5 } },
          paged: true,
        },
      },
    })

    expect(sourceLines(contract)).toEqual([
      'sample.devices-list reads platform.devices.list',
      'sample.accounts-list reads platform.accounts.list kind="all" limit=5 q=search:q paged',
    ])
  })

  it('leaves out a list that follows an entity, and a contract left undefined', () => {
    const contract = sampleContract()

    delete screenIn(contract, 'sample').anchors['sample.devices-list']

    expect(sourceLines(contract)).toEqual([])
    expect(sourceLines(undefined)).toEqual([])
  })
})
