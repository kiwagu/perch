/**
 * The composition root: the only module of the application that imports adapters. It
 * restores the session, which opens the signed-in identity's space, and binds each port to
 * its token; everything below receives ports only. Nothing is opened while nobody is signed in.
 */

import type { ResultAsync } from 'neverthrow'

import {
  type DataError,
  type LocalDb,
  SHAPE_RUNNER,
  type ShapeRunnerPort,
  WRITE_PATH,
  type WritePathPort,
} from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import { Container } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import type { LockManagerLike, SyncHints, SyncTransport } from '@workspace/replica/sync'

import { COMMANDS, type CommandsPort } from '../platform/commands.port'
import { ORGANISATIONS, type OrganisationsPort } from '../platform/organisations.port'
import { SESSION, type SessionPort } from '../platform/session.port'

import { type CommandLogger, createCommandBus } from './commands'
import type { GatewayAuth } from './gateway-auth'
import type { IdentitySpace, SyncState } from './identity-space'
import { createOrganisations } from './organisations'
import type { OrganisationsApi, OrganisationsApiDeps } from './organisations-api'
import { SessionService, type TransportContext, type VisibilitySource } from './session'
import { deviceIdFrom, type KeyValueStorage, savedKeys } from './storage'

/** Where a start stopped: restoring the session, opening the identity's database, or ready. */
export type BootStep = 'restore-session' | 'open-db' | 'ready'

export interface AppRootOptions {
  /** Opens the database of one identity: each identity has its own on the device. */
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
  /** Opens the database of one organisation of an identity: each has its own on the device. */
  readonly openTenantLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one organisation of an identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  readonly gatewayAuth: GatewayAuth
  /** The gateway's organisation routes, called with the device's access token. */
  readonly organisationsApi: (deps: OrganisationsApiDeps) => OrganisationsApi
  /** The channel to the gateway for the tab that leads an identity's sync. */
  readonly transport: (context: TransportContext) => SyncTransport
  /**
   * The browser's Web Locks: one tab per identity leads its sync, and a sign-out waits for the
   * writes of every tab; undefined without them (such a browser does not sync).
   */
  readonly locks: LockManagerLike | undefined
  readonly hints: (identity: IdentityId) => SyncHints
  readonly clock: Clock
  readonly storage: KeyValueStorage
  readonly visibility: VisibilitySource
  readonly logger: CommandLogger
  readonly onStep?: (step: BootStep) => void
  readonly onError: (error: DataError) => void
  readonly onSyncState: (state: SyncState) => void
}

/** What the application receives: ports, and the container that resolves them. */
export interface AppServices {
  readonly container: Container
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly session: SessionPort
  readonly commands: CommandsPort
  readonly organisations: OrganisationsPort
  /** The signed-in identity's space, for a composition that drives it directly: the seed waits on its sync. */
  space(): IdentitySpace | undefined
  close(): Promise<void>
}

export function createAppRoot(options: AppRootOptions): ResultAsync<AppServices, DataError> {
  let last: BootStep | undefined
  const step = (name: BootStep): void => {
    if (name !== last) {
      last = name
      options.onStep?.(name)
    }
  }
  const session = new SessionService({
    auth: options.gatewayAuth,
    openLocal: options.openLocal,
    openTenantLocal: options.openTenantLocal,
    deleteTenantLocal: options.deleteTenantLocal,
    schema: replicaSchema,
    transport: options.transport,
    locks: options.locks,
    hints: options.hints,
    clock: options.clock,
    storage: options.storage,
    visibility: options.visibility,
    onStep: step,
    onSyncState: options.onSyncState,
    onError: options.onError,
  })
  const commands = createCommandBus({
    writePath: session.writePath,
    session,
    deviceId: deviceIdFrom(options.storage),
    logger: options.logger,
  })
  // A route that refuses the access token has the sync leader renew the keys, once.
  const organisations = createOrganisations(
    options.organisationsApi({
      token: () => savedKeys(options.storage)?.access,
      renew: () => session.renewKeys(),
    }),
    session,
  )
  // Reads and writes go to the space of whoever is signed in, and refuse while nobody is.
  const container = new Container()
    .singleton(SHAPE_RUNNER, () => session.runner)
    .singleton(WRITE_PATH, () => session.writePath)
    .singleton(SESSION, () => session)
    .singleton(COMMANDS, () => commands)
    .singleton(ORGANISATIONS, () => organisations)

  step('restore-session')

  return session.restore().map(() => {
    step('ready')

    return {
      container,
      runner: session.runner,
      writePath: session.writePath,
      session,
      commands,
      organisations,
      space: () => session.space(),
      close: () => session.close(),
    }
  })
}
