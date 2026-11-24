/**
 * The composition root: the only module of the application that imports adapters. It binds
 * each port to its token and starts restoring the session, which opens the signed-in identity's
 * space; the services are there at once, while that space opens, and everything below receives
 * ports only. Nothing is opened while nobody is signed in.
 */

import type { ResultAsync } from 'neverthrow'

import {
  type DataError,
  SHAPE_RUNNER,
  type ShapeRunnerPort,
  WRITE_PATH,
  type WritePathPort,
} from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import { Container } from '@workspace/di'

import { ACCOUNT_START_SERVICE } from '../features/user/application/account-start.service'
import {
  settingsCommands,
  settingsShape,
} from '../features/user/application/settings/settings.model.gen'
import {
  SETTINGS_SERVICE,
  SettingsService,
} from '../features/user/application/settings/settings.service'
import { ACCOUNTS } from '../platform/accounts.port'
import { CLIPBOARD } from '../platform/clipboard.port'
import { COMMANDS, type CommandsPort } from '../platform/commands.port'
import { DEVICES, type DevicesPort } from '../platform/devices.port'
import { EVENTS } from '../platform/events.port'
import { INVITATIONS } from '../platform/invitations.port'
import { ORGANISATIONS, type OrganisationsPort } from '../platform/organisations.port'
import { PASSKEYS } from '../platform/passkeys.port'
import { PLATFORM_EVENTS } from '../platform/platform-events.port'
import { SERVED_BUILD } from '../platform/served-build.port'
import { SESSION, type SessionPort } from '../platform/session.port'
import { SYNC_STATUS } from '../platform/sync-status.port'
import { TWO_FACTOR } from '../platform/two-factor.port'

import { accountStarts } from './account-starts'
import type { Credentials } from './accounts-api'
import { appEvents } from './app-events'
import { createCommandBus } from './commands'
import type { BearerDeps } from './gateway-bearer'
import type { IdentitySpace } from './identity-space'
import { createInvitations } from './invitations'
import { createOrganisations } from './organisations'
import { platformEvents } from './platform-events'
import type { AppRootOptions, BootStep } from './root-options'
import { SessionService } from './session'
import { deviceIdFrom, savedSession } from './storage'
import { syncStatus } from './sync-status'

export type { AppRootOptions, BootStep }

/**
 * Why the application did not start: the browser keeps no site data (`storage-blocked`), or the
 * session could not be restored (`open-failed`), with the error each time. When the saved
 * identity's space did not open, `signOutHere` signs that identity out on this device without it
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
  const events = appEvents(options)

  // The routes that act for the signed-in device present the token saved on this browser, only
  // while it is the session of the account this tab shows: never one another tab saved since.
  // The account and its token are read in one step.
  const credentials = (): Credentials | undefined => {
    const here = session.current()
    const saved = savedSession(options.storage)

    return here !== undefined && saved?.identity === here.id
      ? { identity: here.id, token: saved.token, signIn: saved.signIn }
      : undefined
  }
  const bearer: BearerDeps = {
    token: () => credentials()?.token,
    device: () => deviceIdFrom(options.storage),
  }
  const organisationsApi = options.organisationsApi(bearer)
  const session = new SessionService({
    auth: options.gatewayAuth,
    ceremony: options.passkeyCeremony,
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
    // The start of an account a sign-in or a first verification learnt of waits for the first pull.
    keepAccountStart: (signIn, user, from) => starts.keepAfterPull(signIn, user, from),
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
    visibility: options.visibility,
    steady: options.steady,
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
  const twoFactor = options.twoFactorApi(bearer)
  const passkeys = options.passkeysApi(bearer)
  // A console request refused as no operator's takes the role off the account that asked.
  const accounts = options.accountsApi({
    credentials,
    device: bearer.device,
    dropRole: (asker, role) => session.dropRole(asker, role),
  })
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
    theme: options.theme,
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
    .singleton(INVITATIONS, () => createInvitations(options.invitationsApi(bearer), session))
    .singleton(CLIPBOARD, () => options.clipboard)
    .singleton(DEVICES, () => devices)
    .singleton(TWO_FACTOR, () => twoFactor)
    .singleton(PASSKEYS, () => passkeys)
    .singleton(ACCOUNTS, () => accounts)
    .singleton(SERVED_BUILD, () => options.servedBuild)
    .singleton(SYNC_STATUS, () => sync)
    // The facts another tab of the browser sets, which the screens' flows hear.
    .singleton(PLATFORM_EVENTS, () => platformEvents(options.storage))

  step('restore-session')

  // The sign-in whose space the start opens: a sign-out offered when it does not open is of it.
  const restoring = savedSession(options.storage)
  // The sync's state is heard on after a start whose space did not open: once another tab signs
  // that identity out, this tab goes on as a guest's, who may sign in again.
  const opened = session
    .restore()
    .mapErr(
      (error): BootFailure =>
        // Offered only while that sign-in is still the saved one: another tab may have signed it
        // out, and another in, before this tab heard of it (it follows once it does).
        restoring !== undefined && savedSession(options.storage)?.signIn === restoring.signIn
          ? { kind: 'open-failed', error, signOutHere: () => session.signOutUnopened(restoring) }
          : { kind: 'open-failed', error },
    )
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
