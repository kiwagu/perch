/**
 * How the frame is asked before a destructive action: a screen asks before a control whose
 * action destroys what it acts on (`confirmations.ts`) sends its event. Without a provider (a
 * test of one page), every action goes ahead.
 */

import { createContext, useContext } from 'react'

export interface ConfirmGuard {
  /** Asks the user before `control` runs its destructive action; true at once for any other. */
  readonly before: (control: string) => Promise<boolean>
}

export const ConfirmGuardContext = createContext<ConfirmGuard>({
  before: () => Promise.resolve(true),
})

export const useConfirmGuard = (): ConfirmGuard => useContext(ConfirmGuardContext)
