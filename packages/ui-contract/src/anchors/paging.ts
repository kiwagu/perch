/**
 * A paged list, as the app, the tests and the checks read it. A list whose platform source says
 * `paged: true` shows one page of its action's entries: the page the route's search parameter
 * `page` names, of the size its search parameter `size` names (one of the sizes the action
 * declares). It derives four parts: `range`, which says which entries the page shows and how
 * many there are in all (`data-from`, `data-to`, `data-total`); `previous-link` and `next-link`,
 * to the page before and after, each only where there is one; and `size-select`, whose options
 * are the sizes. Each moves to the same route keeping the other search keys, a link changing the
 * page by one, the select setting the size and starting at page 1, and leaves out a value equal
 * to its default (page 1, the action's default size). The size select applies its choice at
 * once, so it holds no input: its element carries `holdsInput={false}`.
 */

/** The search parameter that names the page a paged list shows, from 1. */
export const PAGE = 'page'

/** The search parameter that names how many entries a page of a paged list holds. */
export const SIZE = 'size'

/** The text that says which entries the page shows, of how many in all. */
export const RANGE = 'range'

/** The link to the page before, on every page but the first. */
export const PREVIOUS_LINK = 'previous-link'

/** The link to the page after, on every page that does not hold the last entry. */
export const NEXT_LINK = 'next-link'

/** The select of the page size, whose options are the sizes the action declares. */
export const SIZE_SELECT = 'size-select'

/** The parts a paged list derives, in the order its `derived` lists them. */
export const PAGING_PARTS: readonly string[] = [RANGE, PREVIOUS_LINK, NEXT_LINK, SIZE_SELECT]

/** What a page shows: its range, and the pages its links go to, where it has them. */
export interface Pager {
  readonly range: { readonly from: number; readonly to: number; readonly total: number }
  readonly previous?: number
  readonly next?: number
}

/**
 * The pager of page `page` of `size` entries a page, which shows `shown` entries of `total`:
 * its first and last entry from 1 (0 and 0 when it shows none), the page before when it is not
 * the first, and the page after when entries are left after it.
 */
export function pagerOf({
  page,
  size,
  shown,
  total,
}: {
  readonly page: number
  readonly size: number
  readonly shown: number
  readonly total: number
}): Pager {
  const from = shown === 0 ? 0 : (page - 1) * size + 1

  return {
    range: { from, to: shown === 0 ? 0 : from + shown - 1, total },
    ...(page > 1 ? { previous: page - 1 } : {}),
    ...(page * size < total ? { next: page + 1 } : {}),
  }
}

/** A source as `searchKeysOf` reads it: its `params` and whether it pages. */
export interface SearchedSource {
  readonly params?: Readonly<Record<string, object>> | undefined
  readonly paged?: boolean | undefined
}

/**
 * The search parameters of the route a source reads for: the `{ search: <name> }` its `params`
 * take, then `page` and `size` when it pages. A list reads its source again when one changes.
 */
export const searchKeysOf = (source: SearchedSource): string[] => [
  ...Object.values(source.params ?? {}).flatMap((value) =>
    'search' in value && typeof value.search === 'string' ? [value.search] : [],
  ),
  ...(source.paged === true ? [PAGE, SIZE] : []),
]

/**
 * The search a part of a paged list moves to: `search` with the page and the size `to` names,
 * each left out when it equals its default (page 1, `defaultSize`), the other keys kept.
 */
export function pageSearchOf(
  search: Readonly<Record<string, unknown>>,
  to: { readonly page: number; readonly size: number },
  defaultSize: number,
): Record<string, unknown> {
  const { [PAGE]: _page, [SIZE]: _size, ...kept } = search

  return {
    ...kept,
    ...(to.page === 1 ? {} : { [PAGE]: to.page }),
    ...(to.size === defaultSize ? {} : { [SIZE]: to.size }),
  }
}
