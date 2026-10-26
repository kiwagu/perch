/**
 * Rule 11: each action of `platform.leaving` is an action of the model or the platform, and is
 * listed once; the frame asks before one runs while a field holds unsaved input.
 */

import type { Problem } from '../files'

import { type Contract, locate } from './contract'
import { actionProblems, lookupsOf } from './lookups'

export function leavingProblems(contract: Contract): Problem[] {
  const lookups = lookupsOf(contract)
  const inScreens = locate(contract.screens)
  const seen = new Set<string>()

  return (contract.screens.platform.leaving ?? []).flatMap((action, index) => {
    const at = ['platform', 'leaving', index] as const
    const repeated = seen.has(action)

    seen.add(action)

    return [
      ...actionProblems(lookups, action, undefined, { action: at, params: at }),
      ...(repeated ? [inScreens(at, `"${action}" is listed twice`)] : []),
    ]
  })
}
