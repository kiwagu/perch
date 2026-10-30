import type { ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useShellFrame } from '../shell/shell-frame'

/**
 * What the router puts in the place of a page that failed to render: it tells the frame's flow,
 * which shows the crash message there (`platform.crashed`), and leaves the frame the way to
 * render the page again. It renders nothing itself.
 */
export function CrashSignal({ reset }: ErrorComponentProps) {
  const { actor, live } = useShellFrame()

  useEffect(() => {
    live.renderAgain = reset
    actor.send({ type: 'platform.crashed' })
  }, [actor, live, reset])

  return null
}
