/**
 * A new search starts at page 1. A navigate to a route of a screen with a paged list that sets a
 * search key the list reads (`searchKeysOf`: a search parameter its params take, or `size`)
 * also says `page: 1`, whether or not the route retains `page`: kept, the old page would show the
 * new search past its end; dropped, the literal costs nothing and says it. A navigate that sets
 * only the page, or keys the list does not read, moves freely.
 */

import { PAGE, searchKeysOf } from '../../anchors'
import type { Effect, Problem } from '../../files'

import type { At, InFlow } from './in-flow'

type NavigateSearch = Extract<Effect, { type: 'navigate' }>['params']['search']

/** The paged list of the screen whose route is `path`, with the search keys it reads. */
function pagedListAt(
  { contract }: InFlow,
  path: string,
): { anchor: string; keys: string[] } | undefined {
  const screen = contract.screens.screens.find(({ bindings }) =>
    bindings.some((binding) => binding.path === path),
  )

  for (const [anchor, { source }] of Object.entries(screen?.anchors ?? {})) {
    if (source !== undefined && 'platform' in source && source.paged === true) {
      return { anchor, keys: searchKeysOf(source) }
    }
  }

  return undefined
}

/** A navigate to `to` that sets a key its paged list reads, and not `page: 1`. */
export function pageResetProblems(
  inFlow: InFlow,
  to: string,
  search: NavigateSearch,
  at: At,
): Problem[] {
  const list = pagedListAt(inFlow, to)
  const set = Object.keys(search ?? {}).filter(
    (key) => key !== PAGE && list !== undefined && list.keys.includes(key),
  )
  const page = search?.[PAGE]

  if (list === undefined || set.length === 0 || page === 1) {
    return []
  }

  const sets = set.map((key) => `"${key}"`).join(', ')
  const paged = page === undefined ? 'and not "page"' : `and "page" ${JSON.stringify(page)}`

  return [
    inFlow.inScreens(
      at,
      `sets ${sets}, which the paged list "${list.anchor}" reads, ${paged}: a new search starts at page 1, say page: 1`,
    ),
  ]
}
