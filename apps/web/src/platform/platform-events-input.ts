/**
 * The platform's events (`platform-events.port.ts`) brought to a running machine, the one way a
 * screen's machine and the frame's hear them: each is sent as it comes while the machine runs,
 * carrying what `fields` gives then, when it gives anything (a screen's fields by anchor, for a
 * move the event makes); a machine that ended takes none, and a state that does not handle one
 * lets it pass.
 */

import type { AnyActorRef } from 'xstate'

import type { FieldValues } from './navigate-search'
import type { PlatformEventsPort } from './platform-events.port'

/** A running machine as the events reach it: whether it still runs, and the way to send one. */
type Running = Pick<AnyActorRef, 'send'> & {
  getSnapshot(): { readonly status: string }
}

/** Sends the platform's events to `actor` until the returned stop. */
export function sendPlatformEvents(
  platform: PlatformEventsPort,
  actor: Running,
  fields: () => FieldValues | undefined = () => undefined,
): () => void {
  return platform.listen((event) => {
    if (actor.getSnapshot().status !== 'active') {
      return
    }

    const held = fields()

    actor.send(held === undefined ? event : { ...event, fields: held })
  })
}
