import { okAsync } from 'neverthrow'

import type { EventsPort } from '../../../platform/events.port'

import type { ShellEvent } from './shell-machine'

/**
 * The bus's refusals as the frame's platform events: a change the gateway refused, and refused
 * again, reach the frame's flow, which says them on the notice; a sync protocol it no longer
 * takes reaches it too, which offers to load the page again. Until the returned stop.
 */
export function shellEvents(
  events: EventsPort,
  actor: { readonly send: (event: ShellEvent) => void },
): () => void {
  const rejected = events.subscribe('sync.change-rejected', () => {
    actor.send({ type: 'platform.change-rejected' })

    return okAsync(undefined)
  })
  const reloaded = events.subscribe('sync.changes-reloaded', () => {
    actor.send({ type: 'platform.changes-reloaded' })

    return okAsync(undefined)
  })
  const outdated = events.subscribe('sync.protocol-refused', () => {
    actor.send({ type: 'platform.protocol-refused' })

    return okAsync(undefined)
  })

  return () => {
    rejected()
    reloaded()
    outdated()
  }
}
