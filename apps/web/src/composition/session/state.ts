/**
 * The session's state, as its parts reach it (`SessionHost`): the space it has open, the saved
 * identity while the start opens that identity's space, the subscribers told of a change of
 * identity, and the work that outlives a space it ends.
 */

import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError } from '@workspace/data'

import type { SyncState } from '../identity-space'

import type { SessionHost } from './host'
import type { OpenSpace } from './open-space'
import type { SessionOptions } from './options'
import type { SessionTransitions } from './transitions'

const NOT_SYNCING: SyncState = { leader: false, channel: 'down' }

/** The saved identity while the start opens its space, and the end of that open. */
export interface Opening {
  readonly user: AuthUser
  readonly settled: Promise<unknown>
}

export class SessionState implements SessionHost {
  readonly options: SessionOptions
  readonly #transitions: SessionTransitions
  /** Told after the subscribers of every change of identity. */
  readonly #told: () => void
  readonly #listeners = new Set<(user: AuthUser | undefined) => void>()
  #open: OpenSpace | undefined
  #opening: Opening | undefined
  #retiring: Promise<unknown> = Promise.resolve()

  constructor(options: SessionOptions, transitions: SessionTransitions, told: () => void) {
    this.options = options
    this.#transitions = transitions
    this.#told = told
  }

  open(): OpenSpace | undefined {
    return this.#open
  }

  opened(open: OpenSpace): void {
    this.#open = open
  }

  /** `open` is no longer the session's space: nobody is current, and its sync state is reported no more. */
  drop(open: OpenSpace): void {
    this.#open = undefined
    open.status.live = false
    this.options.onSyncState(NOT_SYNCING)
  }

  generation(): number {
    return this.#transitions.generation()
  }

  isClosed(): boolean {
    return this.#transitions.isClosed()
  }

  serially<T>(run: (generation: number) => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    return this.#transitions.serially(run)
  }

  /** Closes the open space, if any, and tells the subscribers that nobody is signed in. */
  leaveAndTell(): void {
    const open = this.#open

    if (!open) {
      return
    }

    this.drop(open)
    this.retire(open.space.close())
    this.emit(undefined)
  }

  /** Work that outlives the space it ends; `retired` waits for it. */
  retire(work: Promise<void>): void {
    this.#retiring = Promise.all([this.#retiring, work.catch(() => undefined)])
  }

  emit(user: AuthUser | undefined): void {
    // Nobody is signed in any more: neither is the identity whose space the start was opening.
    if (user === undefined) {
      this.#opening = undefined
    }

    for (const listener of this.#listeners) {
      listener(user)
    }

    this.#told()
  }

  /** The identity of the space open now, else the saved one whose space the start is opening. */
  current(): AuthUser | undefined {
    return this.#open?.space.identity ?? this.#opening?.user
  }

  subscribe(listener: (user: AuthUser | undefined) => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  /** The start opens the space of the saved `user`; `restoring` ends that open, opened or not. */
  startOpening(user: AuthUser, restoring: ResultAsync<AuthUser | undefined, DataError>): void {
    const opening: Opening = { user, settled: Promise.resolve(restoring) }

    this.#opening = opening
    void opening.settled.then(() => this.#opened(opening))
  }

  /** The start's open of the saved identity's space, while it runs. */
  opening(): Opening | undefined {
    return this.#opening
  }

  /** Whether the space open now is the one the start's `opening` opened. */
  openFor(opening: Opening): boolean {
    return this.#open?.space.identity.id === opening.user.id
  }

  /** Resolves once the work retired so far has ended. */
  retired(): Promise<unknown> {
    return this.#retiring
  }

  /** The start's open of the saved identity's space ended, opened or not. */
  #opened(opening: Opening): void {
    if (this.#opening === opening) {
      this.#opening = undefined
    }
  }
}
