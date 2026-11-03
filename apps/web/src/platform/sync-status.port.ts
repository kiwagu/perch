import { token } from '@workspace/di'

/** The state of this device's sync, as the frame's `app-shell.sync-message` says it. */
export type SyncStatus = 'synced' | 'sending' | 'connecting' | 'offline' | 'sync-stopped'

/** The state of this device's sync, the same in every tab of the browser. */
export interface SyncStatusPort {
  /** The state now; none while nobody is signed in, whose data syncs nowhere. */
  current(): SyncStatus | undefined
  /** Hears the state change, until the returned stop. */
  subscribe(listener: () => void): () => void
}

export const SYNC_STATUS = token<SyncStatusPort>('SyncStatus')
