/**
 * `CONTRACT_ROLES` and `CONTRACT_ROUTES`: every role of the contract by its name, from the terms
 * file when the contract writes one and from the vocabulary otherwise, and the route path of every
 * binding of a screen: its first by the screen's id (the binding its file is named by), a further
 * one by the id and its path (`<id>@<path>`, `routeKeyOf`), so every path has its name and a
 * binding added before it moves none. A path renamed on the first binding keeps its key; one
 * renamed on a further binding renames its key, a type error at every reader; a further binding
 * made the first takes the id, and every reader of the id with it.
 * Code and tests name a role or a route through them instead of writing it by hand; a route
 * renamed in its screen file reaches them all through the screen's id, which stays.
 */

import type { Contract } from '../check'
import { routeKeyOf } from '../files'

import { constantsText } from './module-text'

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
  ])
}
