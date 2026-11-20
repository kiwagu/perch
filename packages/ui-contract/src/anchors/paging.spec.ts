import { describe, expect, it } from 'vitest'

import {
  NEXT_LINK,
  PAGE,
  PAGING_PARTS,
  PREVIOUS_LINK,
  pagerOf,
  pageSearchOf,
  RANGE,
  SIZE,
  SIZE_SELECT,
  searchKeysOf,
} from './paging'

describe('PAGING_PARTS', () => {
  it('names the four parts a paged list derives, and the two search keys it reads', () => {
    expect(PAGING_PARTS).toEqual([RANGE, PREVIOUS_LINK, NEXT_LINK, SIZE_SELECT])
    expect(PAGING_PARTS).toEqual(['range', 'previous-link', 'next-link', 'size-select'])
    expect([PAGE, SIZE]).toEqual(['page', 'size'])
  })
})

describe('pagerOf', () => {
  it('gives the range of a middle page and both links', () => {
    expect(pagerOf({ page: 2, size: 25, shown: 25, total: 120 })).toEqual({
      range: { from: 26, to: 50, total: 120 },
      previous: 1,
      next: 3,
    })
  })

  it('leaves out the previous link on the first page and the next one on the last', () => {
    expect(pagerOf({ page: 1, size: 10, shown: 10, total: 11 })).toEqual({
      range: { from: 1, to: 10, total: 11 },
      next: 2,
    })
    expect(pagerOf({ page: 2, size: 10, shown: 1, total: 11 })).toEqual({
      range: { from: 11, to: 11, total: 11 },
      previous: 1,
    })
    expect(pagerOf({ page: 5, size: 25, shown: 20, total: 120 })).toEqual({
      range: { from: 101, to: 120, total: 120 },
      previous: 4,
    })
  })

  it('says 0 and 0 on a page that holds no entry, past the last or of an empty search', () => {
    expect(pagerOf({ page: 9, size: 25, shown: 0, total: 120 })).toEqual({
      range: { from: 0, to: 0, total: 120 },
      previous: 8,
    })
    expect(pagerOf({ page: 1, size: 25, shown: 0, total: 0 })).toEqual({
      range: { from: 0, to: 0, total: 0 },
    })
  })
})

describe('searchKeysOf', () => {
  it('reads the search parameters its params take, and page and size when it pages', () => {
    const params = { q: { search: 'q' }, kind: { value: 'all' }, tag: { search: 'tag' } }

    expect(searchKeysOf({ params })).toEqual(['q', 'tag'])
    expect(searchKeysOf({ params, paged: true })).toEqual(['q', 'tag', PAGE, SIZE])
    expect(searchKeysOf({ paged: true })).toEqual([PAGE, SIZE])
    expect(searchKeysOf({})).toEqual([])
  })
})

describe('pageSearchOf', () => {
  it('moves to a page or a size, keeping the other keys, and leaves out each default', () => {
    const search = { q: 'ann', page: 2, size: 10 }

    expect(pageSearchOf(search, { page: 3, size: 10 }, 25)).toEqual({ q: 'ann', page: 3, size: 10 })
    expect(pageSearchOf(search, { page: 1, size: 10 }, 25)).toEqual({ q: 'ann', size: 10 })
    expect(pageSearchOf(search, { page: 1, size: 25 }, 25)).toEqual({ q: 'ann' })
    expect(pageSearchOf({}, { page: 2, size: 25 }, 25)).toEqual({ page: 2 })
  })
})
