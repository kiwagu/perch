/** What one expansion of a flow reads and reports. */

import type { Control, FailureOf } from '../derive'

/** The codes an anchor carries, in its order; undefined when no screen declares the anchor. */
export type CodesOf = (anchor: string) => readonly string[] | undefined

/** What the expansion of one screen's flow reads of the contract. */
export interface FlowLookups {
  readonly codesOf: CodesOf
  /** The failure of an action: the codes `show: <anchor>` shows in the `onError` of its invoke. */
  readonly failureOf: FailureOf
  /** The screen's buttons bound to one action, whose regions the flow may leave out. */
  readonly controls: readonly Control[]
  /** The id of the screen, which the name of a derived region leaves out. */
  readonly screen: string
  /** The frame's toast anchor, which says the success of a model action; none, nothing is derived. */
  readonly toast: string | undefined
  /** The platform actions whose success toasts, each with its code (`platform.yaml` `toasts`). */
  readonly platformToasts: Readonly<Record<string, string>>
}

/** A toast the loader derived: the frame's toast anchor, its code, the model action it says succeeded. */
export interface DerivedToast {
  readonly anchor: string
  readonly code: string
  readonly action: string
}

/** Why a part of the flow could not be expanded, at its path in the screen file. */
export interface ExpansionIssue {
  readonly at: readonly PropertyKey[]
  readonly message: string
}

export interface Expansion extends FlowLookups {
  /** The guards the flow's `meta.guards` writes by failure code, each with its codes. */
  readonly codeGuards: ReadonlyMap<string, readonly string[]>
  readonly issues: ExpansionIssue[]
  readonly toasts: DerivedToast[]
  /** The codes the flow's own `show`s put on the toast anchor. */
  readonly writtenToasts: string[]
}
