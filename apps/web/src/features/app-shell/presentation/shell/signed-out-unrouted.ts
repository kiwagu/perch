import { useEffect } from 'react'

import type { SessionPort } from '../../../../platform/session.port'

/** What the hook sends the frame's event to: its actor. */
interface FrameActor {
  send(event: { readonly type: 'platform.signed-out' }): void
}

/**
 * The account the frame shows going away while it renders no screen (its data did not open):
 * signed out, or another account signed in since. The frame's platform event, which the shell's
 * container sends once a screen renders. Heard while `noScreen` holds and the session exists, and
 * judged too as listening begins: the session tells only what changes, and the account may have
 * gone between the screen's last render and this. `shown` is the account the frame shows, none
 * for a guest's start.
 */
export function useSignedOutUnrouted(
  session: SessionPort | undefined,
  actor: FrameActor,
  noScreen: boolean,
  shown: () => string | undefined,
): void {
  useEffect(() => {
    if (session === undefined || !noScreen) {
      return undefined
    }

    const gone = (user: ReturnType<SessionPort['current']>) => {
      const account = shown()

      return user === undefined || (account !== undefined && user.id !== account)
    }
    const tell = () => actor.send({ type: 'platform.signed-out' })

    if (shown() !== undefined && gone(session.current())) {
      tell()
    }

    return session.subscribe((user) => {
      if (gone(user)) {
        tell()
      }
    })
  }, [session, actor, noScreen, shown])
}
