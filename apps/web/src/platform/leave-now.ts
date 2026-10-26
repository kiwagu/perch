/**
 * A move the app makes for a leave nobody started here (another tab signed the account in):
 * it passes the frame's guard, since nothing here can keep what was typed.
 */

import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

export function useLeaveNow(): (to: string) => void {
  const navigate = useNavigate()

  return useCallback(
    (to: string) => {
      void navigate({ to, ignoreBlocker: true })
    },
    [navigate],
  )
}
