/**
 * The flows of the UI contract the app's machines are held to, for `machines.spec.ts`. On a
 * branch the pre-commit hook sets `CONTRACT_AHEAD=1` and names the branch's merge base with
 * `main` (`CONTRACT_AHEAD_BASE`): a business commit may change a flow before its implementation,
 * so a machine may lack what its flow added (`aheadOf`), or still be exactly its screen's flow
 * as the contract had it at the base, or at the branch's own HEAD, the contract the app was
 * built from: a business commit taken onto a branch whose implementation already follows an
 * earlier one changes a flow the base may not have at all. A machine that equals none of them
 * is held to its flow now, which it fails. On `main` and in `bun run check` every machine is held
 * to its whole flow.
 */

import { contractAt } from '@workspace/ui-contract'
import { laggingOf, type Projection, sameValue } from '@workspace/ui-contract/machines'

/** On a branch the pre-commit hook sets it: the contract may run ahead of the app. */
export const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

/**
 * The flows of the screens at a revision, by screen id (none outside the hook's ahead mode, or
 * where the revision has no contract), or why the contract there does not load.
 */
export type FlowsAt =
  | { readonly flows: ReadonlyMap<string, unknown> }
  | { readonly problem: string }

/**
 * The flows at `revision` of the repository at `root`, read once per spec; none outside the
 * ahead mode, or without a revision.
 */
export function flowsAt(revision: string | undefined, root: string): FlowsAt {
  if (!AHEAD || revision === undefined || revision === '') {
    return { flows: new Map() }
  }

  let contract: ReturnType<typeof contractAt>

  try {
    contract = contractAt(revision, root)
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }

  return {
    flows:
      'missing' in contract
        ? new Map()
        : new Map(
            contract.screens.screens.flatMap((screen) =>
              screen.flow === undefined ? [] : [[screen.id, screen.flow] as const],
            ),
          ),
  }
}

/**
 * What an app's machine must equal on a branch: an earlier flow of its screen (at the branch's
 * HEAD, at its base) it still equals exactly, as the app has not started on what the branch
 * changed since; otherwise its flow now, less what the machine has not built yet (`laggingOf`).
 */
export function heldFlow(
  app: Projection,
  flow: Projection,
  earlier: readonly (Projection | undefined)[],
): Projection {
  return laggingOf(
    app,
    flow,
    earlier.find((was) => was !== undefined && sameValue(app, was)),
  )
}
