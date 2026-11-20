import type { ReactNode } from 'react'

import { type FieldFactsByAnchor, FieldFactsContext } from './context'

export interface FieldFactsProviderProps {
  /** The facts of the fields, by the anchor each renders; a provider inside another replaces it whole. */
  readonly facts: FieldFactsByAnchor
  readonly children: ReactNode
}

/**
 * Gives the fields inside it their facts: an `Input`, a `Textarea`, a `Select` and an
 * `OptionSelect` look theirs up by the anchor they render, and an element's own prop wins over them.
 */
export function FieldFactsProvider({ facts, children }: FieldFactsProviderProps) {
  return <FieldFactsContext.Provider value={facts}>{children}</FieldFactsContext.Provider>
}
