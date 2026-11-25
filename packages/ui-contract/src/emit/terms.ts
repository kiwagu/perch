/**
 * `CONTRACT_ROLES` and `CONTRACT_ROUTES`: every role of the contract by its name, from the terms
 * file when the contract writes one and from the vocabulary otherwise, and the route path of every
 * binding of a screen: its first by the screen's id (the binding its file is named by), a further
 * one by the id and its path (`<id>@<path>`, `routeKeyOf`), so every path has its name. A
 * binding added as a further one moves no key; one added as the first takes the id, and every
 * reader of the id with it. The first binding's path renamed keeps its key, the screen's id, so it
 * reaches every reader; a further binding's path renamed renames its key, a type error at each.
 * `CONTRACT_INVARIANTS`: the numbers each invariant states under `values`, a count by its name and a
 * duration in milliseconds under its name with `Ms` (`window` -> `windowMs`), so a window the code
 * keeps as `{ limit, windowMs }` is the emitted object. Code and tests name a role, a route or an
 * invariant's number through them instead of writing it by hand.
 */

import type { Contract } from '../check'
import { routeKeyOf } from '../files'
import type { InvariantValue } from '../schemas'

import { constantsText } from './module-text'

const MILLISECONDS = { seconds: 1000, minutes: 60_000, hours: 3_600_000 } as const

/** A value as code reads it: a count by its name, a duration in milliseconds under `<name>Ms`. */
function numberOf(name: string, value: InvariantValue): readonly [string, number] {
  if (typeof value === 'number') {
    return [name, value]
  }

  const [unit, amount] = Object.entries(value)[0] as [keyof typeof MILLISECONDS, number]

  return [`${name}Ms`, amount * MILLISECONDS[unit]]
}

const byName = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
  a < b ? -1 : a > b ? 1 : 0

export function termsModuleOf({
  vocabulary,
  screens,
}: Pick<Contract, 'vocabulary' | 'screens'>): string {
  return constantsText('terms', [
    {
      name: 'CONTRACT_ROLES',
      holds: 'Every role of the contract, by its name.',
      entries: Object.keys(vocabulary.roles).map((role) => [role, role] as const),
    },
    {
      name: 'CONTRACT_ROUTES',
      holds:
        "The route path of every binding of a screen: its first by the screen's id, which names its file; a further one by the id and its path, `<id>@<path>`.",
      entries: screens.screens.flatMap(({ id, bindings }) =>
        bindings.map(({ path }, index) => [routeKeyOf(id, index, path), path] as const),
      ),
    },
    {
      name: 'CONTRACT_INVARIANTS',
      holds:
        'Every invariant that states numbers, by its name: each count by its name, each duration in milliseconds under its name with `Ms`.',
      entries: Object.entries(screens.platform.invariants ?? {}).flatMap(([name, { values }]) =>
        values === undefined
          ? []
          : [
              [
                name,
                Object.fromEntries(
                  Object.entries(values)
                    .map(([value, stated]) => numberOf(value, stated))
                    .sort(byName),
                ),
              ] as const,
            ],
      ),
    },
  ])
}
