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
}

/** Why a part of the flow could not be expanded, at its path in the screen file. */
export interface ExpansionIssue {
  readonly at: readonly PropertyKey[]
  readonly message: string
}

export interface Expansion extends FlowLookups {
  readonly issues: ExpansionIssue[]
}
