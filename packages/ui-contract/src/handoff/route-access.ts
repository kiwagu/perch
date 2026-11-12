/**
 * Who each route serves, as the hand-over lists it: `<path> guard <guard>` when the binding has
 * one, and `<path> serves <role>` for each role it serves. A route added whole shows every line,
 * and a role taken from a binding shows as the line removed.
 */

import type { Contract } from '../check'

/** The access lines of every binding of `contract`; none for a contract left undefined. */
export const routeAccessLines = (contract: Contract | undefined): string[] =>
  (contract?.screens.screens ?? []).flatMap(({ bindings }) =>
    bindings.flatMap(({ path, guard, roles }) => [
      ...(guard === undefined ? [] : [`${path} guard ${guard}`]),
      ...roles.map((role) => `${path} serves ${role}`),
    ]),
  )
