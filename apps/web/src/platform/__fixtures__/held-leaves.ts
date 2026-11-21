/**
 * The fields the app's navigating controls are held to lose, for the spec that holds the frame's
 * leave question to the contract (`leaving-contract.spec.ts`). A control whose flow moves to
 * another screen loses the fields the engine derives for it (`leaves.loses`: the fields of its
 * screen that hold input, but those its move carries in its search and the control itself). On a
 * branch the pre-commit hook sets `CONTRACT_AHEAD=1` and names the branch's merge base with `main`
 * (`CONTRACT_AHEAD_BASE`): a business commit may add a navigating control before the app renders
 * it, or a field that an existing control's leave now loses before the app asks for it. So a
 * control the base did not have and the app does not list yet waits, and a control the app lists
 * as the contract had it at the base, and not as it has it now, is held to the base; a control the
 * base had too never waits, so the app dropping it fails. On
 * `main` and in `bun run check` every control is held as the contract says it now. A control the
 * app lists that the contract does not have, or lists with fields neither contract derives, fails
 * either way.
 */

import { type AnchorDef, contractAt } from '@workspace/ui-contract'

/** The fields each navigating control loses when it leaves its screen, in the engine's order. */
export type Leaves = Readonly<Record<string, readonly string[]>>

/** The anchors of a screen, as far as its leaves are read from them. */
interface Anchored {
  readonly anchors: Readonly<Record<string, AnchorDef>>
}

/** The leaves of `screens`: each control that carries `leaves`, with the fields it loses. */
export function leavesOf(screens: readonly Anchored[]): Record<string, string[]> {
  return Object.fromEntries(
    screens.flatMap((screen) =>
      Object.entries(screen.anchors).flatMap(([anchor, def]) =>
        def.leaves === undefined ? [] : [[anchor, [...def.leaves.loses]] as const],
      ),
    ),
  )
}

/**
 * The leaves of the contract at the branch's base, in the ahead mode with a base named; none
 * otherwise, and none where the base has no contract. A base that names no commit, or whose
 * contract does not load, throws.
 */
export function leavesAtBase(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): Leaves {
  const base = env['CONTRACT_AHEAD_BASE']

  if (env['CONTRACT_AHEAD'] !== '1' || base === undefined || base === '') {
    return {}
  }

  const contract = contractAt(base, root)

  return 'missing' in contract ? {} : leavesOf(contract.screens.screens)
}

const sameFields = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((field, at) => field === b[at])

export interface HeldLeavesInput {
  /** The leaves the app lists. */
  readonly app: Leaves
  /** The leaves the contract derives now. */
  readonly now: Leaves
  /** The leaves the contract derived at the branch's base (`leavesAtBase`). */
  readonly base: Leaves
  /** Whether the hook's ahead mode is on. */
  readonly ahead: boolean
}

/**
 * The leaves the app's are held to: without the ahead mode, the contract's now; in it, the controls
 * of now that the app lists or the base had, each as the contract derives it now unless the app
 * lists it as the base derived it and not as now, then as the base.
 */
export function heldLeaves({ app, now, base, ahead }: HeldLeavesInput): Leaves {
  if (!ahead) {
    return now
  }

  return Object.fromEntries(
    Object.entries(now)
      .filter(([anchor]) => Object.hasOwn(app, anchor) || Object.hasOwn(base, anchor))
      .map(([anchor, loses]) => {
        const listed = app[anchor]
        const was = base[anchor]
        const held = was !== undefined && !sameFields(listed, loses) && sameFields(listed, was)

        return [anchor, held ? was : loses] as const
      }),
  )
}
