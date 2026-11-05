import { useEffect } from 'react'

import type { SessionPort } from '../../../../platform/session.port'

/** What the hook sends the frame's event to: its actor. */
interface FrameActor {
  send(event: { readonly type: 'platform.signed-out' }): void
}

/**
 * The account going away while the frame renders no screen (its data did not open): the frame's
 * platform event, which the shell's container sends once a screen renders. Heard while `noScreen`
 * holds and the session exists.
 */
export function useSignedOutUnrouted(
  session: SessionPort | undefined,
  actor: FrameActor,
  noScreen: boolean,
): void {
  useEffect(() => {
    if (session === undefined || !noScreen) {
      return undefined
    }

    return session.subscribe((user) => {
      if (user === undefined) {
        actor.send({ type: 'platform.signed-out' })
      }
    })
  }, [session, actor, noScreen])
}
