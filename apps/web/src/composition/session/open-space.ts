import type { Leadership, SyncHints } from '@workspace/replica/sync'

import type { IdentitySpace } from '../identity-space'
import type { KeptSession } from '../storage'

import type { HeardSignOut } from './write-barrier'

/** Whether an open space still speaks for the tab: a space being closed reports nothing more. */
export interface SpaceStatus {
  live: boolean
}

/** The space a session has open, with the lead, the hints and the status it holds for it. */
export interface OpenSpace {
  readonly space: IdentitySpace
  /**
   * The sign-in whose space it is, as the open read it: whatever ends the space ends that sign-in,
   * never one saved since.
   */
  readonly signIn: KeptSession
  readonly leadership: Leadership | undefined
  readonly status: SpaceStatus
  /** The hints between the tabs of the identity; the space closes them. */
  readonly hints: SyncHints
  readonly heard: HeardSignOut
}
