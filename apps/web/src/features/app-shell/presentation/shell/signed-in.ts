import { useEffect } from 'react'
import type { AnyActorRef } from 'xstate'

import { clearsSignInNotice } from '../../../../platform/frame-effects'
import type { SessionPort } from '../../../../platform/session.port'

/** What the hook sends the frame's event to and hears the frame's effects from: its actor. */
type FrameActor = Pick<AnyActorRef, 'on'> & {
  send(event: { readonly type: 'platform.signed-in' }): void
}

/**
 * An account signed in on this device, in this tab or another: the frame's platform event, sent in
 * every state once the session exists. The session tells each change of who is signed in: an
 * account it tells after nobody, or another than the one it told last, signed in; the one it shows
 * as listening begins (the saved one the start opens) signed in before this page. Heard from the
 * session itself, so a sign-out and a sign-in told at once count both, where a render would see
 * only the last. While the frame renders no screen (`noScreen`), the clear of the sign-in page's
 * notice the event brings reaches the session here; once one renders, the shell's container runs
 * the frame's effects (`useFrameEffects`).
 */
export function useSignedIn(
  session: SessionPort | undefined,
  actor: FrameActor,
  noScreen: boolean,
): void {
  useEffect(() => {
    if (session === undefined) {
      return undefined
    }

    let told = session.current()?.id

    return session.subscribe((user) => {
      const before = told

      told = user?.id

      if (user !== undefined && user.id !== before) {
        actor.send({ type: 'platform.signed-in' })
      }
    })
  }, [session, actor])

  useEffect(() => {
    if (session === undefined || !noScreen) {
      return undefined
    }

    const cleared = actor.on('clear', (event: unknown) => {
      if (clearsSignInNotice(event)) {
        session.dropNotice()
      }
    })

    return () => cleared.unsubscribe()
  }, [session, actor, noScreen])
}
