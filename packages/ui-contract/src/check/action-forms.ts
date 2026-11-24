/**
 * The form of a platform action's codes. From version 6 they are a map, each code with when it
 * answers: its condition, or the invariants it refuses for. A list of their names, the older form,
 * says no condition and is refused there; a contract at an older version loads and checks it as
 * before (`check/editions.ts`).
 */

import type { Problem } from '../files'

import { type Contract, locate } from './contract'
import { since } from './editions'

/** The version from which an action's codes are a map and a `result` of one string keeps the budget. */
export const BEHAVIOUR_EDITION = 6

const LIST = `a list of codes; from version ${BEHAVIOUR_EDITION} an action's codes are a map, each code with when it answers: \`<code>: <condition>\`, or \`<code>: { invariant: <name> }\` for a rule several actions keep`

export function actionFormsProblems(contract: Contract): Problem[] {
  if (!since(contract, BEHAVIOUR_EDITION)) {
    return []
  }

  const inScreens = locate(contract.screens)

  return Object.entries(contract.screens.platform.actions).flatMap(([name, { codes }]) =>
    Array.isArray(codes) ? [inScreens(['platform', 'actions', name, 'codes'], LIST)] : [],
  )
}
