import type { ErrorComponentProps } from '@tanstack/react-router'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'

import { useShellFrame } from '../shell/shell-frame'

/**
 * What the router puts in the place of a page that failed to render: it tells the frame's flow,
 * which shows the crash message there (`platform.crashed`), and leaves the frame the way to
 * render the page again. A page that failed while a signed-in account's data opens is told once
 * the data is open: the frame shows no crash message before. It renders nothing itself.
 */
export function CrashSignal({ reset }: ErrorComponentProps) {
  const { actor, live } = useShellFrame()
  const dataOpening = useSelector(actor, (state) => state.matches('opening-data'))

  useEffect(() => {
    if (!dataOpening) {
      live.renderAgain = reset
      actor.send({ type: 'platform.crashed' })
    }
  }, [dataOpening, actor, live, reset])

  return null
}
