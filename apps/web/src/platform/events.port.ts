import type { ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import { token } from '@workspace/di'
import type { DomainEvent } from '@workspace/kernel'

import type { PushRejection } from './session.port'

/** A command's write committed: the params it ran with (the write path resolves with nothing). */
export type CommandDone = DomainEvent<`${string}.done`, { readonly params: unknown }>
/** A command failed: the params and the error. */
export type CommandFailed = DomainEvent<
  `${string}.failed`,
  { readonly params: unknown; readonly error: BusError }
>
/** The server refused a change, and this device undid it. */
export type ChangeRejected = DomainEvent<'sync.change-rejected', PushRejection>
/** The server refused the undo too: the region loaded again, the later unsent changes lost. */
export type ChangesReloaded = DomainEvent<'sync.changes-reloaded', PushRejection>
/**
 * The server no longer takes the sync protocol of the build this tab runs: the channel ended,
 * and this device's changes stop syncing until the page loads again.
 */
export type ProtocolRefused = DomainEvent<'sync.protocol-refused', null>

/** The facts of the app, after they happened. */
export type AppEvent =
  | CommandDone
  | CommandFailed
  | ChangeRejected
  | ChangesReloaded
  | ProtocolRefused

export type EventSubscriber<E extends AppEvent> = (event: E) => ResultAsync<unknown, BusError>

/**
 * Hears the app's facts; only the composition root publishes them. A sync event is picked by its
 * name; a command's outcome, named by its command, is heard through `onAny`.
 */
export interface EventsPort {
  subscribe<Name extends AppEvent['name']>(
    name: Name,
    subscriber: EventSubscriber<Extract<AppEvent, { readonly name: Name }>>,
  ): () => void
  once<Name extends AppEvent['name']>(
    name: Name,
    subscriber: EventSubscriber<Extract<AppEvent, { readonly name: Name }>>,
  ): () => void
  onAny(subscriber: EventSubscriber<AppEvent>): () => void
}

export const EVENTS = token<EventsPort>('Events')
