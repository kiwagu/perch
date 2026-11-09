/**
 * Rule 18: a paged list. A list whose platform source says `paged: true` shows one page of its
 * action's entries, the page and the size the route's search parameters `page` and `size` name:
 * its action pages (`paged: { sizes, default }`: the sizes each once, the smallest first, the
 * default one of them), taking the number parameters `page` and `size`; every route of its
 * screen declares `page`, an integer from 1 whose default is 1, and `size`, an integer of the
 * action's sizes whose default is the action's; no source's `params` names `page` or `size`, which
 * the route gives; a screen pages one list, as a route has one `page`; and a paged list has at
 * most 3 segments, since its size options (`<list>.size-select.option`) add two to its name and
 * an anchor has 5 at most. A navigate that starts a new search says `page: 1` (`flow/pages.ts`).
 */

import { PAGE, SIZE, segmentsOf, sizeOptionOf } from '../anchors'
import type { Binding, Problem } from '../files'

import { type Contract, declaredAnchors, type InScreens, locate, own } from './contract'
import { searchOf } from './lookups'

type PlatformAction = Contract['screens']['platform']['actions'][string]

/** The segments a paged list has at most: its size options add two to the 5 of an anchor. */
const PAGED_LIST_SEGMENTS = 3

/** What a source names of its paging: the page and the size the route gives. */
const SOURCE_PARAMS = {
  [PAGE]: '"page" is the page of a paged source: write paged: true, never a param',
  [SIZE]: '"size" is the page size of a paged source: write paged: true, never a param',
} as const

/** What a paged list reads of the route, by search key. */
const ROUTE_KEYS = { [PAGE]: 'the page', [SIZE]: 'the page size' } as const

/** The action's sizes listed once each, the smallest first, with its default among them. */
function actionProblems(name: string, action: PlatformAction, inScreens: InScreens): Problem[] {
  const { paged } = action

  if (paged === undefined) {
    return []
  }

  const at = ['platform', 'actions', name, 'paged']
  const numbers = [PAGE, SIZE].every((param) => own(action.params, param)?.type === 'number')
  const ordered = paged.sizes.every(
    (size, index) => index === 0 || size > (paged.sizes[index - 1] ?? 0),
  )

  return [
    ...(numbers
      ? []
      : [inScreens(at, 'a paged action takes "page" and "size" parameters of type number')]),
    ...(ordered
      ? []
      : [
          inScreens(
            [...at, 'sizes'],
            'a paged action lists each page size once, the smallest first',
          ),
        ]),
    ...(paged.sizes.includes(paged.default)
      ? []
      : [
          inScreens(
            [...at, 'default'],
            `${paged.default} is none of the sizes ${paged.sizes.join(', ')}`,
          ),
        ]),
  ]
}

/** Whether the property `name` of a binding's search is as a paged list reads it. */
function readsAs(
  binding: Binding,
  name: typeof PAGE | typeof SIZE,
  paged: NonNullable<PlatformAction['paged']>,
): boolean {
  const property = own(binding.search?.properties ?? {}, name)

  if (property === undefined) {
    return true
  }

  if (name === PAGE) {
    return property.type === 'integer' && property.minimum === 1 && property.default === 1
  }

  const values = new Set(property.enum ?? [])

  return (
    property.type === 'integer' &&
    values.size === paged.sizes.length &&
    paged.sizes.every((size) => values.has(size)) &&
    property.default === paged.default
  )
}

export function pagingProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)
  const { actions } = contract.screens.platform
  const paging = new Map<unknown, string>()

  return [
    ...declaredAnchors(contract.screens).flatMap(({ anchor, def, screen, at }) => {
      const { source } = def

      if (source === undefined || !('platform' in source)) {
        return []
      }

      const reserved = Object.keys(source.params ?? {}).flatMap((key) =>
        key === PAGE || key === SIZE
          ? [inScreens([...at, 'source', 'params', key], SOURCE_PARAMS[key])]
          : [],
      )

      if (source.paged !== true) {
        return reserved
      }

      const where = [...at, 'source', 'paged']
      const paged = own(actions, source.platform)?.paged
      const first = paging.get(screen)
      const search = searchOf(screen)

      if (first === undefined) {
        paging.set(screen, anchor)
      }

      return [
        ...reserved,
        ...(segmentsOf(anchor).length > PAGED_LIST_SEGMENTS
          ? [
              inScreens(
                where,
                `a paged list derives "${sizeOptionOf(anchor)}", past the 5 segments of an anchor: a paged list has at most ${PAGED_LIST_SEGMENTS} segments`,
              ),
            ]
          : []),
        ...(paged === undefined && own(actions, source.platform) !== undefined
          ? [
              inScreens(
                where,
                `platform action "${source.platform}" does not page: declare paged: { sizes, default } on it`,
              ),
            ]
          : []),
        ...([PAGE, SIZE] as const).flatMap((key) =>
          search.has(key)
            ? []
            : [
                inScreens(
                  where,
                  `every route of the screen declares the search parameter "${key}", ${ROUTE_KEYS[key]} a paged list reads`,
                ),
              ],
        ),
        ...(first === undefined
          ? []
          : [
              inScreens(
                where,
                `"${first}" pages already: a screen pages one list, as a route has one "page"`,
              ),
            ]),
        ...(paged === undefined
          ? []
          : screen.bindings.flatMap((binding, index) =>
              ([PAGE, SIZE] as const).flatMap((key) =>
                readsAs(binding, key, paged)
                  ? []
                  : [
                      inScreens(
                        [
                          'screens',
                          contract.screens.screens.indexOf(screen),
                          'bindings',
                          index,
                          'search',
                          'properties',
                          key,
                        ],
                        key === PAGE
                          ? '"page" is the page of a paged list: an integer from 1 whose default is 1'
                          : `"size" is the page size of a paged list: an integer of ${paged.sizes.join(', ')} whose default is ${paged.default}`,
                      ),
                    ],
              ),
            )),
      ]
    }),
    ...Object.entries(actions).flatMap(([name, action]) => actionProblems(name, action, inScreens)),
  ]
}
