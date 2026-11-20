/**
 * What a field takes from a provider when its element says nothing itself: facts about the field,
 * keyed by its anchor, the `data-testid` its element renders. The kit knows no contract and no
 * app: whoever mounts the provider passes the map in, and without a provider a field takes
 * nothing.
 */

import { createContext, type HTMLInputTypeAttribute, useContext } from 'react'

/** What is known of one field. */
export interface FieldFacts {
  /** The most characters an `Input` or a `Textarea` takes. */
  readonly maxLength?: number | undefined
  /** The type of an `Input`, which a `PasswordInput` keeps its own of. */
  readonly type?: HTMLInputTypeAttribute | undefined
  /** Whether the field colors its border by its state, before its form's say. */
  readonly marksState?: boolean | undefined
  /** Whether the field keeps what is typed until an action takes it; false for a choice that applies at once. */
  readonly holdsInput?: boolean | undefined
}

/** The facts of the fields, by the anchor each renders. */
export type FieldFactsByAnchor = Readonly<Record<string, FieldFacts>>

export const FieldFactsContext = createContext<FieldFactsByAnchor | undefined>(undefined)

/** The facts of the field that renders this anchor; none without a provider, an anchor or an entry. */
export const useFieldFacts = (anchor: string | undefined): FieldFacts | undefined => {
  const facts = useContext(FieldFactsContext)

  // An own entry only: an anchor named like an Object member is no entry.
  return facts === undefined || anchor === undefined || !Object.hasOwn(facts, anchor)
    ? undefined
    : facts[anchor]
}
