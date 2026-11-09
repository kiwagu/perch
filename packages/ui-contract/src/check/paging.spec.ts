import { describe, expect, it } from 'vitest'

import { PAGING_PARTS } from '../anchors'
import { type AnchorDef, formatProblem } from '../files'

import type { Contract } from './contract'
import { sampleContract, screenIn } from './contract.fixture'
import { pagingProblems } from './paging'

const printed = (contract: Contract): string[] => pagingProblems(contract).map(formatProblem)

const SAMPLE = 'contract/domain/screens/sample/$key.yaml:1:'
const PLATFORM = 'contract/domain/platform.yaml:1:'

const LIST = 'sample.accounts-list'

const pagedList = (source: Record<string, unknown> = {}): AnchorDef =>
  ({
    kind: 'list',
    source: { platform: 'accounts.list', params: { q: { search: 'q' } }, paged: true, ...source },
    derived: [...PAGING_PARTS],
  }) as AnchorDef

/**
 * The sample with a paged list of accounts: the action pages by 10, 25 or 50, 25 by default, and
 * the route declares `q`, `page` and `size` as a paged list reads them.
 */
function sample(): Contract {
  const contract = sampleContract()
  const screen = screenIn(contract, 'sample')

  contract.screens.platform.actions['accounts.list'] = {
    description: 'Reads the accounts.',
    params: {
      q: { type: 'string', description: 'The text an account contains.' },
      page: { type: 'number', description: 'The page, from 1.' },
      size: { type: 'number', description: 'The entries a page holds.' },
    },
    paged: { sizes: [10, 25, 50], default: 25 },
    result: 'the page of accounts, the newest first, and how many accounts the search finds',
    codes: ['failed'],
  }
  Object.assign(screen.bindings[0]?.search?.properties ?? {}, {
    q: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    size: { type: 'integer', enum: [10, 25, 50], default: 25 },
  })
  screen.anchors[LIST] = pagedList()

  return contract
}

const action = (contract: Contract) =>
  contract.screens.platform.actions['accounts.list'] ?? expect.unreachable('the action')

const searchOf = (contract: Contract) =>
  screenIn(contract, 'sample').bindings[0]?.search?.properties ?? expect.unreachable('a search')

describe('pagingProblems', () => {
  it('finds nothing in a paged list whose action and route say its paging', () => {
    expect(printed(sample())).toEqual([])
    expect(printed(sampleContract())).toEqual([])
  })

  it('refuses page or size among the params of a source: the route gives them', () => {
    const contract = sample()

    screenIn(contract, 'sample').anchors[LIST] = pagedList({
      params: { q: { search: 'q' }, page: { search: 'page' }, size: { value: 10 } },
    })

    expect(printed(contract)).toEqual([
      `${SAMPLE} anchors["${LIST}"].source.params.page: "page" is the page of a paged source: write paged: true, never a param`,
      `${SAMPLE} anchors["${LIST}"].source.params.size: "size" is the page size of a paged source: write paged: true, never a param`,
    ])
  })

  it('wants the action of a paged source to page', () => {
    const contract = sample()
    const { paged: _paged, ...unpaged } = action(contract)

    contract.screens.platform.actions['accounts.list'] = unpaged

    expect(printed(contract)).toEqual([
      `${SAMPLE} anchors["${LIST}"].source.paged: platform action "accounts.list" does not page: declare paged: { sizes, default } on it`,
    ])
  })

  it('wants every route of the screen to declare page and size, as a paged list reads them', () => {
    const contract = sample()
    const { page: _page, size: _size, ...rest } = searchOf(contract)
    const [binding] = screenIn(contract, 'sample').bindings

    Object.assign(binding ?? {}, { search: { ...binding?.search, properties: rest } })

    expect(printed(contract)).toEqual([
      `${SAMPLE} anchors["${LIST}"].source.paged: every route of the screen declares the search parameter "page", the page a paged list reads`,
      `${SAMPLE} anchors["${LIST}"].source.paged: every route of the screen declares the search parameter "size", the page size a paged list reads`,
    ])
  })

  it('wants page an integer from 1 whose default is 1, and size one of the sizes by default', () => {
    for (const [page, size] of [
      [
        { type: 'integer', minimum: 0, default: 1 },
        { type: 'integer', enum: [10, 25], default: 25 },
      ],
      [
        { type: 'number', minimum: 1, default: 1 },
        { type: 'integer', enum: [50, 25, 10], default: 10 },
      ],
      [{ type: 'integer', minimum: 1 }, { type: 'string' }],
    ]) {
      const contract = sample()

      Object.assign(searchOf(contract), { page, size })

      expect(printed(contract)).toEqual([
        `${SAMPLE} bindings[0].search.properties.page: "page" is the page of a paged list: an integer from 1 whose default is 1`,
        `${SAMPLE} bindings[0].search.properties.size: "size" is the page size of a paged list: an integer of 10, 25, 50 whose default is 25`,
      ])
    }

    const contract = sample()

    Object.assign(searchOf(contract), {
      size: { type: 'integer', enum: [50, 10, 25], default: 25 },
    })

    expect(printed(contract)).toEqual([])
  })

  it('pages one list a screen, as a route has one page', () => {
    const contract = sample()

    screenIn(contract, 'sample').anchors['sample.more-list'] = pagedList()

    expect(printed(contract)).toEqual([
      `${SAMPLE} anchors["sample.more-list"].source.paged: "${LIST}" pages already: a screen pages one list, as a route has one "page"`,
    ])
  })

  it('wants a paged action to take page and size numbers, and its sizes in order with the default', () => {
    const contract = sample()
    const paging = action(contract)

    paging.params = {
      q: { type: 'string', description: 'The text.' },
      page: { type: 'string', description: 'The page.' },
    }
    paging.paged = { sizes: [25, 10, 25], default: 30 }

    expect(printed(contract)).toEqual([
      `${SAMPLE} bindings[0].search.properties.size: "size" is the page size of a paged list: an integer of 25, 10, 25 whose default is 30`,
      `${PLATFORM} actions["accounts.list"].paged: a paged action takes "page" and "size" parameters of type number`,
      `${PLATFORM} actions["accounts.list"].paged.sizes: a paged action lists each page size once, the smallest first`,
      `${PLATFORM} actions["accounts.list"].paged.default: 30 is none of the sizes 25, 10, 25`,
    ])
  })
})
