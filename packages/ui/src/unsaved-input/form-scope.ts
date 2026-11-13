/**
 * The form a field belongs to. When a submit starts, the form captures what each of its fields
 * holds; when that submit saved, each captured field takes the value it held then as the last
 * value the app gave it. What was typed during the save, and a field added since, stay unsaved.
 * The form also says whether its fields mark their state; a field's own say wins.
 */

import { createContext, useContext } from 'react'

/** Captures what the field holds now, and returns how to mark that value saved. */
export type Capture = () => () => void

export interface FormScope {
  /** Enlists a field's capture; the return value unlists it. */
  readonly enlist: (capture: Capture) => () => void
  /** Whether the form's fields mark their state, unless a field says otherwise. */
  readonly marksState: boolean
}

export const FormScopeContext = createContext<FormScope | undefined>(undefined)

export const useFormScope = (): FormScope | undefined => useContext(FormScopeContext)

/** Whether a field marks its state: its own say, else its form's, else true. */
export const useMarksState = (own: boolean | undefined): boolean => {
  const form = useFormScope()

  return own ?? form?.marksState ?? true
}
