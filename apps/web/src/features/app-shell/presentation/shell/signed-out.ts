import { useEffect, useRef } from 'react'

import type { SessionPort } from '../../../../platform/session.port'

/** What the hook sends the frame's event to: its actor. */
interface FrameActor {
  send(event: { readonly type: 'platform.signed-out' }): void
}

/** What a run of the hook's listening judged: the account the frame showed as it began, the last one told. */
interface Judged {
  readonly shown: string | undefined
  readonly told: string | undefined
}

/**
 * The account the frame shows going away, by its own sign-out or from another device: the
 * frame's platform event, heard while `listening` holds and the session exists (the shell's
 * container while a screen renders, the start while none does). Heard from the session itself, as
 * `signed-in.ts` hears a sign-in: each change counts, so a sign-out and another account's sign-in
 * told at once are the first account's sign-out, where a render would see only the last. An
 * account the session tells after the one it told last, or nobody after one, signed it out;
 * nobody told again signs out no one. Judged too as listening begins: the session tells only
 * what changes, and the account may have gone between the last render and this. `shown` is the
 * account the frame shows, none for a guest's start. Listening that begins again while the frame
 * still shows the account it showed (React's StrictMode runs an effect twice) goes on from the
 * account it told last, so an account it told gone is not told gone again.
 */
export function useSignedOut(
  session: SessionPort | undefined,
  actor: FrameActor,
  listening: boolean,
  shown: () => string | undefined,
): void {
  const judged = useRef<Judged | undefined>(undefined)

  useEffect(() => {
    if (session === undefined || !listening) {
      return undefined
    }

    const tell = () => actor.send({ type: 'platform.signed-out' })
    const seen = shown()
    const last = judged.current
    let told = last !== undefined && last.shown === seen ? last.told : seen
    const now = session.current()?.id

    if (told !== undefined && now !== told) {
      tell()
    }

    told = now

    const stop = session.subscribe((user) => {
      const before = told

      told = user?.id

      if (before !== undefined && user?.id !== before) {
        tell()
      }
    })

    return () => {
      stop()
      judged.current = { shown: seen, told }
    }
  }, [session, actor, listening, shown])
}
