/** `ui-contract routes [--json]`. */

import { renderRoutes, routesOf } from '../routes'

import { currentContract } from './problems'

export function routes(argv: readonly string[]): number {
  const contract = currentContract(process.cwd())

  if (contract === undefined) {
    return 1
  }

  const view = routesOf(contract)

  console.log(argv.includes('--json') ? JSON.stringify(view, null, 2) : renderRoutes(view))

  return 0
}
