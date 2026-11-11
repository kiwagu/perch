/**
 * The moves of a paged list's parts (`paged: true` in the contract): the links to the pages
 * before and after, and the size select. They are no flow's: the engine derives them for every
 * paged list. Each moves along the route the page is at, the other keys of its search kept
 * (`pageSearchOf`): a link to its page with the size kept, the select to the first page with the
 * size chosen. The select writes that size as it is, the default included: the router's strip
 * then takes a default out of the address, while a size left out would be given back by the
 * route's `retain` (an earlier size chosen). A link also gives the address it moves to, its real
 * `href`. A move goes past the frame's guard as any move within a screen does.
 */

import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'

import { pageSearchOf } from '@workspace/ui-contract/anchors'

/** What a paged list's parts move with. */
export interface PageMoves {
  /** The address of page `page` of the same search and size. */
  readonly pageHref: (page: number) => string
  /** Moves to page `page` of the same search and size. */
  readonly toPage: (page: number) => Promise<void>
  /** Moves to the first page of the same search, `size` entries a page. */
  readonly toSize: (size: number) => Promise<void>
}

/**
 * The moves of the parts of the paged list whose route's search is `search` now (the route read
 * it: its `size` is one of the sizes), `defaultSize` the size the address leaves out.
 */
export function usePageMoves(
  search: Readonly<Record<string, unknown>> & { readonly size: number },
  defaultSize: number,
): PageMoves {
  const router = useRouter()
  const navigate = useNavigate()
  const path = useRouterState({ select: (state) => state.location.pathname })
  const ofPage = (page: number) => pageSearchOf(search, { page, size: search.size }, defaultSize)

  return {
    pageHref: (page) => router.buildLocation({ to: path, search: ofPage(page) }).href,
    toPage: (page) => navigate({ to: path, search: ofPage(page) }),
    toSize: (size) =>
      navigate({
        to: path,
        search: { ...pageSearchOf(search, { page: 1, size }, defaultSize), size },
      }),
  }
}
