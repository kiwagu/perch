/**
 * The lists that read a platform action, as the hand-over lists them: one line per list,
 * `<anchor> reads platform.<action>`, then each param by name, `<param>=search:<name>` for a
 * search parameter of the route and `<param>=<constant as JSON>` for a constant, then `paged`
 * when it pages. A list moved to another action, another search or its paging shows as its line
 * removed and its new one added; a list added whole shows its line, which nothing else in the
 * summary says. A list that follows an entity of the model has none.
 */

import { type Contract, declaredAnchors } from '../check'

import { byName } from './change'

/** The source line of every list of `contract` that reads a platform action. */
export const sourceLines = (contract: Contract | undefined): string[] =>
  contract === undefined
    ? []
    : declaredAnchors(contract.screens).flatMap(({ anchor, def: { source } }) =>
        source === undefined || !('platform' in source)
          ? []
          : [
              [
                `${anchor} reads platform.${source.platform}`,
                ...Object.entries(source.params ?? {})
                  .sort(([a], [b]) => byName(a, b))
                  .map(([param, value]) =>
                    'search' in value
                      ? `${param}=search:${value.search}`
                      : `${param}=${JSON.stringify(value.value)}`,
                  ),
                ...(source.paged === true ? ['paged'] : []),
              ].join(' '),
            ],
      )
