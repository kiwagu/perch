/** What the composition root is given: the adapters of the device it runs on, and its hooks. */

import type { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import type { LockManagerLike, SyncHints, SyncTransport } from '@workspace/replica/sync'

import type { AccountsPort } from '../platform/accounts.port'
import type { ClipboardPort } from '../platform/clipboard.port'
import type { DevicesPort } from '../platform/devices.port'
import type { InvitationsPort } from '../platform/invitations.port'
import type { PasskeysPort } from '../platform/passkeys.port'
import type { ServedBuildPort } from '../platform/served-build.port'
import type { Theme } from '../platform/theme'
import type { TwoFactorPort } from '../platform/two-factor.port'

import type { AccountsDeps } from './accounts-api'
import type { CommandLogger } from './commands'
import type { GatewayAuth } from './gateway-auth'
import type { BearerDeps } from './gateway-bearer'
import type { SyncState } from './identity-space'
import type { OrganisationsApi } from './organisations-api'
import type { PasskeyCeremony } from './passkey-ceremony'
import type { TransportContext, VisibilitySource } from './session'
import type { KeyValueStorage } from './storage'

/** Where a start stopped: restoring the session, opening the identity's database, or ready. */
export type BootStep = 'restore-session' | 'open-db' | 'ready'

export interface AppRootOptions {
  /** Opens the database of one identity: each identity has its own on the device. */
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one identity while it is not open. */
  readonly deleteLocal: (identity: IdentityId) => ResultAsync<void, DataError>
  /** Opens the database of one organisation of an identity: each has its own on the device. */
  readonly openTenantLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one organisation of an identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  readonly gatewayAuth: GatewayAuth
  /** The label sign-ins and verifications give this browser, next to its own id: "Chrome on Linux". */
  readonly deviceLabel: string
  /** The theme this device shows now, which the settings of an account it starts begin with. */
  readonly theme: () => Theme
  /** Whether the browser says it has a network (`navigator.onLine`). */
  readonly online: () => boolean
  /** Hears the browser's network come or go (its `online` and `offline` events). */
  readonly onOnlineChange: (listener: () => void) => () => void
  /** The gateway's organisation routes, called with the device's session token and id. */
  readonly organisationsApi: (deps: BearerDeps) => OrganisationsApi
  /** The gateway's device and invitation routes, called the same way. */
  readonly devicesApi: (deps: BearerDeps) => DevicesPort
  readonly invitationsApi: (deps: BearerDeps) => InvitationsPort
  /** The gateway's routes of the account's second factor and passkeys, called the same way. */
  readonly twoFactorApi: (deps: BearerDeps) => TwoFactorPort
  readonly passkeysApi: (deps: BearerDeps) => PasskeysPort
  /** The browser's window that picks a passkey for a sign-in. */
  readonly passkeyCeremony: PasskeyCeremony
  /** The gateway's console routes, asked with the credentials a request starts with. */
  readonly accountsApi: (deps: AccountsDeps) => AccountsPort
  /** The clipboard of the device, which an invitation's link is copied to. */
  readonly clipboard: ClipboardPort
  /** The channel to the gateway for the tab that leads an identity's sync. */
  readonly transport: (context: TransportContext) => SyncTransport
  /**
   * The browser's Web Locks: one tab per identity leads its sync, and a sign-out waits for the
   * writes of every tab; undefined without them (such a browser does not sync).
   */
  readonly locks: LockManagerLike | undefined
  readonly hints: (identity: IdentityId) => SyncHints
  readonly clock: Clock
  /** Milliseconds on this tab's steady clock (`performance.now()`), which setting the wall clock does not move. */
  readonly steady: () => number
  readonly storage: KeyValueStorage
  readonly visibility: VisibilitySource
  /** Hears a newer build of the app the server serves, which the frame offers to load. */
  readonly servedBuild: ServedBuildPort
  readonly logger: CommandLogger
  /** Logs the name of every event the bus carries: development builds only; off when left out. */
  readonly logEvents?: boolean
  readonly onStep?: (step: BootStep) => void
  readonly onError: (error: DataError) => void
  readonly onSyncState: (state: SyncState) => void
}
