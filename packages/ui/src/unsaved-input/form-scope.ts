/** The form a field belongs to: a submit that saved tells each enlisted field it is clean. */

import { createContext, useContext } from 'react'

export interface FormScope {
  /** Enlists a field's "mark clean"; the return value unlists it. */
  readonly enlist: (markClean: () => void) => () => void
}

export const FormScopeContext = createContext<FormScope | undefined>(undefined)

export const useFormScope = (): FormScope | undefined => useContext(FormScopeContext)
