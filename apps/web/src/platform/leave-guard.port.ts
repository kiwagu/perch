/**
 * How the frame is asked before a leave that would lose unsaved input: a screen asks before a
 * leaving control runs, the router's blocker asks before another screen opens. Without a
 * provider (a test of one page), every leave goes ahead.
 */

import { createContext, useContext } from 'react'

export interface LeaveGuard {
  /** Asks the user while a field holds unsaved input; true at once when none does. */
  readonly confirm: () => Promise<boolean>
  /** Asks before `control` runs, when its action leaves and a field holds unsaved input. */
  readonly before: (control: string) => Promise<boolean>
}

export const LeaveGuardContext = createContext<LeaveGuard>({
  confirm: () => Promise.resolve(true),
  before: () => Promise.resolve(true),
})

export const useLeaveGuard = (): LeaveGuard => useContext(LeaveGuardContext)
