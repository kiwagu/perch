/**
 * `CONTRACT_ROLES` and `CONTRACT_ROUTES`: every role of the contract by its name, from the terms
 * file when the contract writes one and from the vocabulary otherwise, and the route path of every
 * screen bound to one, by the screen's id, from its first binding, the one its file is named by.
 * Code and tests name a role or a route through them instead of writing it by hand; a route
 * renamed in its screen file reaches them all through the screen's id, which stays.
 */

import type { Contract } from '../check'

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
        "The route path of every screen bound to one, by the screen's id: its first binding's, which names its file.",
      entries: screens.screens.flatMap(({ id, bindings: [first] }) =>
        first === undefined ? [] : [[id, first.path] as const],
      ),
    },
  ])
}
