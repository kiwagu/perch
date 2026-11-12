import { describe, expect, it } from 'vitest'

import { PAGING_PARTS } from '../../anchors'
import { type AnchorDef, type Effect, formatProblem } from '../../files'
import type { Contract } from '../contract'
import { afterSave, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow.states.saving.invoke.onDone'

const navigate = (search: Record<string, unknown>): Effect =>
  ({ type: 'navigate', params: { to: '/sample/$key', search } }) as Effect

/** The sample whose route reads `q`, `page` and `size` for a paged list of accounts. */
function sample(): Contract {
  const contract = sampleContract()
  const screen = screenIn(contract, 'sample')

  Object.assign(screen.bindings[0]?.search?.properties ?? {}, {
    q: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    size: { type: 'integer', enum: [10, 25], default: 25 },
  })
  screen.anchors['sample.accounts-list'] = {
    kind: 'list',
    source: { platform: 'devices.list', params: { q: { search: 'q' } }, paged: true },
    derived: [...PAGING_PARTS],
  } as AnchorDef

  return contract
}

describe('a navigate to the route of a paged list', () => {
  it('starts a new search at page 1, and moves to a page or elsewhere freely', () => {
    const contract = sample()

    afterSave(contract, [
      navigate({ q: { anchor: 'sample.title-input' }, page: 1 }),
      navigate({ size: 10, page: 1, tab: 'a' }),
      navigate({ page: 3 }),
      navigate({ tab: 'b' }),
    ])

    expect(printed(contract)).toEqual([])
    expect(printed(sampleContract())).toEqual([])
  })

  it('refuses one that sets a key the list reads without page: 1', () => {
    const contract = sample()

    afterSave(contract, [
      navigate({ q: { anchor: 'sample.title-input' } }),
      navigate({ q: 'ann', size: 10, tab: 'a' }),
      navigate({ q: 'ann', page: 2 }),
    ])

    const reads = 'which the paged list "sample.accounts-list" reads'
    const says = 'a new search starts at page 1, say page: 1'

    expect(printed(contract)).toEqual([
      `${AT}[0].actions[0].params.search: sets "q", ${reads}, and not "page": ${says}`,
      `${AT}[1].actions[0].params.search: sets "q", "size", ${reads}, and not "page": ${says}`,
      `${AT}[2].actions[0].params.search: sets "q", ${reads}, and "page" 2: ${says}`,
    ])
  })
})
