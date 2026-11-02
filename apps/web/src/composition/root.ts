/**
 * The composition root: the only module of the application that imports adapters. It binds
 * each port to its token and starts restoring the session, which opens the signed-in identity's
 * space; the services are there at once, while that space opens, and everything below receives
 * ports only. Nothing is opened while nobody is signed in.
 */

import { okAsync, type ResultAsync } from 'neverthrow'

import { EventBus } from '@workspace/cqrs'
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

import { ACCOUNT_START_SERVICE } from '../features/user/application/account-start.service'
import {
  settingsCommands,
  settingsShape,
} from '../features/user/application/settings/settings.model.gen'
import {
  SETTINGS_SERVICE,
  SettingsService,
} from '../features/user/application/settings/settings.service'
import { COMMANDS, type CommandsPort } from '../platform/commands.port'
import { DEVICES, type DevicesPort } from '../platform/devices.port'
import { type AppEvent, EVENTS } from '../platform/events.port'
import { ORGANISATIONS, type OrganisationsPort } from '../platform/organisations.port'
import { SERVED_BUILD, type ServedBuildPort } from '../platform/served-build.port'
import { SESSION, type SessionPort } from '../platform/session.port'
import { SYNC_STATUS } from '../platform/sync-status.port'

import { accountStarts } from './account-starts'
import { type CommandLogger, createCommandBus } from './commands'
import type { GatewayAuth } from './gateway-auth'
import type { BearerDeps } from './gateway-bearer'
import type { IdentitySpace, SyncState } from './identity-space'
import { createOrganisations } from './organisations'
import type { OrganisationsApi } from './organisations-api'
import { SessionService, type TransportContext, type VisibilitySource } from './session'
import { deviceIdFrom, type KeyValueStorage, savedIdentity, savedToken } from './storage'
import { syncStatus } from './sync-status'

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
  /** Whether the browser says it has a network (`navigator.onLine`). */
  readonly online: () => boolean
  /** Hears the browser's network come or go (its `online` and `offline` events). */
  readonly onOnlineChange: (listener: () => void) => () => void
  /** The gateway's organisation routes, called with the device's session token and id. */
  readonly organisationsApi: (deps: BearerDeps) => OrganisationsApi
  /** The gateway's device routes, called the same way. */
  readonly devicesApi: (deps: BearerDeps) => DevicesPort
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
  /** Hears a newer build of the app the server serves, which the frame offers to load. */
  readonly servedBuild: ServedBuildPort
  readonly logger: CommandLogger
  /** Logs the name of every event the bus carries: development builds only; off when left out. */
  readonly logEvents?: boolean
  readonly onStep?: (step: BootStep) => void
  readonly onError: (error: DataError) => void
  readonly onSyncState: (state: SyncState) => void
}

/**
 * Why the application did not start: the browser keeps no site data (`storage-blocked`), or the
 * session could not be restored (`open-failed`), with the error each time. When the saved
 * identity's space did not open, `signOutHere` signs it out on this device without it
 * (`SessionService.signOutUnopened`), so a database that will never open is no dead end.
 */
export type BootFailure =
  | { readonly kind: 'storage-blocked'; readonly error: DataError }
  | {
      readonly kind: 'open-failed'
      readonly error: DataError
      readonly signOutHere?: () => ResultAsync<void, DataError>
    }

/**
 * What the start gives the page: the services at once, and the open of the saved identity's
 * space, which ends once it is open (at once when nobody is signed in) or says why it did not open.
 */
export interface AppStart {
  readonly services: AppServices
  readonly opened: ResultAsync<void, BootFailure>
}

/** What the application receives: ports, and the container that resolves them. */
export interface AppServices {
  readonly container: Container
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly session: SessionPort
  readonly commands: CommandsPort
  readonly organisations: OrganisationsPort
  readonly devices: DevicesPort
  /** The signed-in identity's space, for a composition that drives it directly: the seed waits on its sync. */
  space(): IdentitySpace | undefined
  close(): Promise<void>
}

export function createAppRoot(options: AppRootOptions): AppStart {
  let last: BootStep | undefined
  const step = (name: BootStep): void => {
    if (name !== last) {
      last = name
      options.onStep?.(name)
    }
  }
  // The facts of the app, after they happened: the commands' outcomes, the changes the gateway
  // refused. Only the root publishes; the features hear them through `EVENTS`.
  const events = new EventBus<AppEvent>()

  if (options.logEvents === true) {
    events.onAny((event) => {
      options.logger.info({ event: event.name })

      return okAsync(undefined)
    })
  }

  // The routes that act for the signed-in device present the token saved on this browser.
  const bearer: BearerDeps = {
    token: () => savedToken(options.storage),
    device: () => deviceIdFrom(options.storage),
  }
  const organisationsApi = options.organisationsApi(bearer)
  const session = new SessionService({
    auth: options.gatewayAuth,
    // A sign-in reads them with the token it was given, before it saves anything.
    listMemberships: (token, device) =>
      options.organisationsApi({ token: () => token, device: () => device }).list(),
    deviceLabel: options.deviceLabel,
    online: options.online,
    openLocal: options.openLocal,
    deleteLocal: options.deleteLocal,
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
    onSyncState: (state) => {
      options.onSyncState(state)
      sync.syncState(state)
      starts.syncState(state)
    },
    // The start of an account a sign-in learnt of waits for this device's first pull.
    keepAccountStart: (user, from) => starts.keepAfterPull(user, from),
    onError: options.onError,
    publish: (event) => {
      void events.publish([event]).match(
        () => undefined,
        (failure) =>
          options.logger.warn({ event: event.name, outcome: failure.code, causes: failure.causes }),
      )
    },
  })
  // The state of this device's sync, the same in every tab: the leading tab shares its part.
  const sync = syncStatus({
    storage: options.storage,
    clock: options.clock,
    online: options.online,
    onOnlineChange: options.onOnlineChange,
    signedIn: () => session.current() !== undefined,
    unsent: () => session.space()?.unsent(),
    protocolRefused: () => session.protocolRefused(),
    canSync: options.locks !== undefined,
  })
  const commands = createCommandBus({
    writePath: session.writePath,
    session,
    deviceId: deviceIdFrom(options.storage),
    logger: options.logger,
    events,
  })
  const organisations = createOrganisations(organisationsApi, session)
  const devices = options.devicesApi(bearer)
  // The account's settings, which the frame reads and stores as well as the account's pages.
  const settings = new SettingsService(session.runner, commands, {
    shape: settingsShape,
    commands: settingsCommands,
  })
  // Listening before the session restores: the start of the page finishes a start kept here.
  const starts = accountStarts({
    session,
    space: () => session.space(),
    clock: options.clock,
    runner: session.runner,
    commands,
    settings,
    storage: options.storage,
    locks: options.locks,
    logger: options.logger,
  })
  // Reads and writes go to the space of whoever is signed in, and refuse while nobody is.
  const container = new Container()
    .singleton(SHAPE_RUNNER, () => session.runner)
    .singleton(WRITE_PATH, () => session.writePath)
    .singleton(SESSION, () => session)
    .singleton(COMMANDS, () => commands)
    .singleton(EVENTS, () => events)
    .singleton(SETTINGS_SERVICE, () => settings)
    .singleton(ACCOUNT_START_SERVICE, () => starts.service)
    .singleton(ORGANISATIONS, () => organisations)
    .singleton(DEVICES, () => devices)
    .singleton(SERVED_BUILD, () => options.servedBuild)
    .singleton(SYNC_STATUS, () => sync)

  step('restore-session')

  const opened = session
    .restore()
    .mapErr((error): BootFailure => {
      // No frame reads the state of the sync of a start that failed.
      sync.stop()

      return savedIdentity(options.storage)
        ? { kind: 'open-failed', error, signOutHere: () => session.signOutUnopened() }
        : { kind: 'open-failed', error }
    })
    .map(() => step('ready'))

  return {
    services: {
      container,
      runner: session.runner,
      writePath: session.writePath,
      session,
      commands,
      organisations,
      devices,
      space: () => session.space(),
      close: () => {
        sync.stop()

        return session.close()
      },
    },
    opened,
  }
}
