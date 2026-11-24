/** What the parts of a session may do with it: its open space, its transitions and its subscribers. */

import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError } from '@workspace/data'

import type { OpenSpace } from './open-space'
import type { SessionOptions } from './options'

export interface SessionHost {
  readonly options: SessionOptions
  /** The space the session has open, if any. */
  open(): OpenSpace | undefined
  /** `open` is the session's space from now on: it was just opened. */
  opened(open: OpenSpace): void
  /** `open` stops being the session's space: nobody is current, and its sync state is reported no more. */
  drop(open: OpenSpace): void
  /** The generation of the latest transition; a transition that finds a later one started is dropped. */
  generation(): number
  isClosed(): boolean
  /** Runs `run` as a session transition, once the transitions before it have finished. */
  serially<T>(run: (generation: number) => ResultAsync<T, DataError>): ResultAsync<T, DataError>
  /** Closes the open space, if any, and tells the subscribers that nobody is signed in. */
  leaveAndTell(): void
  /**
   * The identity this tab shows without its space (the start opening it, or done without opening
   * it) is no longer the one the browser keeps: nobody is current from now on, at once, and the
   * subscribers are told.
   */
  leaveUnopened(): void
  /** Work that outlives the space it ends; closing the session waits for it. */
  retire(work: Promise<void>): void
  /** Tells the subscribers who is signed in now. */
  emit(user: AuthUser | undefined): void
}
