/** What one expansion of a flow reads and reports. */

/** The codes an anchor declares, in its order; undefined when no screen declares the anchor. */
export type CodesOf = (anchor: string) => readonly string[] | undefined

/** Why a part of the flow could not be expanded, at its path in the screen file. */
export interface ExpansionIssue {
  readonly at: readonly PropertyKey[]
  readonly message: string
}

export interface Expansion {
  readonly codesOf: CodesOf
  readonly issues: ExpansionIssue[]
}
