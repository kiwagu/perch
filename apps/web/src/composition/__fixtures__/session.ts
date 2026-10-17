import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError, LocalDb, ShapeRunnerPort } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { syncHints } from '@workspace/replica/sync'
import {
  FakeHintChannel,
  FakeLocks,
  type GatewayStub,
  gatewayStub,
  type ManualClock,
  manualClock,
  type StubTransport,
} from '@workspace/replica/testing'

import type { CommandsPort } from '../../platform/commands.port'
import { type CommandLogger, createCommandBus } from '../commands'
import type { GatewayAuth } from '../gateway-auth'
import type { SyncState, Visibility } from '../identity-space'
import { SessionService, type TransportContext } from '../session'
import { type MemoryStorage, memoryStorage } from '../storage'

import { fakeGatewayAuth } from './gateway-auth'

export interface TestWorldOptions {
  /** The browser's storage; tabs of one browser share it. */
  readonly storage?: MemoryStorage
  /** Whether the device reaches the gateway stub (the default); offline, its channel never comes up. */
  readonly online?: boolean
  /** Wraps each identity database as it opens, e.g. to hold its queries. */
  readonly wrap?: (local: LocalDb) => LocalDb
  readonly logger?: CommandLogger
  /** The browser's Web Locks, shared by its tabs; by default the tab has a lock manager of its own. */
  readonly locks?: FakeLocks
  /** Another world's gateway, for a second tab or device of the same test; its owner closes it. */
  readonly gateway?: TestGateway
  /** The identity databases of the browser, which its tabs share; by default each tab opens its own. */
  readonly databases?: BrowserDatabases
  /** The browser's BroadcastChannel bus for sync hints; by default the tab hears no other tab. */
  readonly hints?: Set<FakeHintChannel>
  /** The organisations every account belongs to: the gateway signs in and welcomes with them. */
  readonly memberships?: readonly Membership[]
}

/** The identity databases of one browser: its tabs open the same database for an identity. */
export interface BrowserDatabases {
  /**
   * A tab's connection to the identity's database. Closing or deleting it lets the tab go;
   * the database closes once the last tab has let it go.
   */
  open(identity: IdentityId): ResultAsync<LocalDb, DataError>
}

export function browserDatabases(): BrowserDatabases {
  const shared = new Map<IdentityId, { readonly local: LocalDb; tabs: number }>()

  return {
    open(identity) {
      const held = shared.get(identity)
      const opening = held
        ? okAsync(held)
        : openTestDb().map((local) => {
            const opened = { local, tabs: 0 }

            shared.set(identity, opened)

            return opened
          })

      return opening.map((opened): LocalDb => {
        let holding = true
        const release = async () => {
          if (!holding) {
            return
          }

          holding = false
          opened.tabs -= 1

          if (opened.tabs === 0) {
            shared.delete(identity)
            await opened.local.close()
          }
        }

        opened.tabs += 1

        return { ...opened.local, close: release, destroy: release }
      })
    },
  }
}

/** The gateway stub, its database and the clock it shares with the devices. */
export interface TestGateway {
  readonly stub: GatewayStub
  readonly clock: ManualClock
  readonly server: LocalDb
}

/** A session as the root wires it, over embedded databases, the gateway stub and a manual clock. */
export interface TestWorld {
  readonly session: SessionService
  readonly commands: CommandsPort
  readonly auth: GatewayAuth
  readonly storage: MemoryStorage
  readonly stub: GatewayStub
  readonly clock: ManualClock
  readonly gateway: TestGateway
  /** What the session reported through `onError`. */
  readonly failures: DataError[]
  /** The sync states the session reported, oldest first. */
  readonly states: SyncState[]
  /** The identities whose databases were opened, in order. */
  opened(): IdentityId[]
  /** The identities whose databases were deleted, in order. */
  destroyed(): IdentityId[]
  /** The organisations whose databases were opened, by key, in order. */
  tenantsOpened(): string[]
  /** The organisations whose databases were deleted, by key, in order. */
  tenantsDestroyed(): string[]
  /** The transport contexts the session handed out, newest last. */
  contexts(): readonly TransportContext[]
  /** The channels to the gateway stub the session opened, newest last. */
  transports(): readonly StubTransport[]
  /** Tells the session the tab went to the background or came back. */
  setVisibility(state: Visibility): void
  /** Moves the clock on until the promise settles, for waits the gateway does not end. */
  driveClock<T>(promise: PromiseLike<T>): Promise<T>
  close(): Promise<void>
}

const silent: CommandLogger = { info: () => {}, warn: () => {} }

async function openTestGateway(memberships: readonly Membership[]): Promise<TestGateway> {
  const clock = manualClock()
  const schema = `${readSchema('directory')}\n${readSchema('tenant')}`
  const server = (await openTestDb({ schema }))._unsafeUnwrap()

  return {
    stub: gatewayStub({ local: server, schema: replicaSchema, clock, memberships }),
    clock,
    server,
  }
}

export async function openTestWorld(options: TestWorldOptions = {}): Promise<TestWorld> {
  const memberships = options.memberships ?? []
  const gateway = options.gateway ?? (await openTestGateway(memberships))
  const { stub, clock } = gateway
  const storage = options.storage ?? memoryStorage()
  const auth = fakeGatewayAuth(memberships)
  const failures: DataError[] = []
  const states: SyncState[] = []
  const opened: IdentityId[] = []
  const destroyed: IdentityId[] = []
  const tenantsOpened: string[] = []
  const tenantsDestroyed: string[] = []
  const contexts: TransportContext[] = []
  const transports: StubTransport[] = []
  const visibilityListeners = new Set<(state: Visibility) => void>()
  let visibility: Visibility = 'visible'
  const session = new SessionService({
    auth,
    openLocal: (identity) =>
      (options.databases ? options.databases.open(identity) : openTestDb()).map(
        (local): LocalDb => {
          opened.push(identity)

          const wrapped = options.wrap ? options.wrap(local) : local

          return {
            ...wrapped,
            destroy: async () => {
              destroyed.push(identity)
              await local.destroy()
            },
          }
        },
      ),
    openTenantLocal: (_identity, key) =>
      openTestDb({ schema: readSchema('tenant'), database: 'tenant' }).map((local): LocalDb => {
        tenantsOpened.push(key)

        return {
          ...local,
          destroy: async () => {
            tenantsDestroyed.push(key)
            await local.destroy()
          },
        }
      }),
    schema: replicaSchema,
    transport: (context) => {
      const transport = stub.transport(context.identity)

      contexts.push(context)
      transports.push(transport)
      // The browser's WebSocket transport hands renewed keys and memberships to the context
      // and calls `onEnded` itself; the stub tells its listeners.
      transport.onMessage((message) => {
        if (message.type === 'tokens') {
          context.onTokens({ access: message.access, refresh: message.refresh })
        }

        if (message.type === 'welcome' || message.type === 'memberships') {
          context.onMemberships(message.memberships)
        }
      })
      transport.onEnded(context.onEnded)

      if (options.online === false) {
        transport.goOffline()
      }

      return transport
    },
    // Without shared locks the tab is alone: its locks are granted as soon as they are asked for.
    locks: options.locks ?? new FakeLocks(),
    hints: () => syncHints(options.hints ? new FakeHintChannel(options.hints) : undefined),
    clock,
    storage,
    visibility: {
      current: () => visibility,
      onChange: (listener) => {
        visibilityListeners.add(listener)

        return () => visibilityListeners.delete(listener)
      },
    },
    onSyncState: (state) => states.push(state),
    onError: (error) => failures.push(error),
  })
  const commands = createCommandBus({
    writePath: session.writePath,
    session,
    deviceId: 'dev-test',
    logger: options.logger ?? silent,
  })

  return {
    session,
    commands,
    auth,
    storage,
    stub,
    clock,
    gateway,
    failures,
    states,
    opened: () => [...opened],
    destroyed: () => [...destroyed],
    tenantsOpened: () => [...tenantsOpened],
    tenantsDestroyed: () => [...tenantsDestroyed],
    contexts: () => [...contexts],
    transports: () => [...transports],
    setVisibility: (state) => {
      visibility = state

      for (const listener of visibilityListeners) {
        listener(state)
      }
    },
    driveClock: async (promise) => {
      let done = false
      const settled = Promise.resolve(promise).finally(() => {
        done = true
      })

      while (!done) {
        await clock.advance(1_000)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      return settled
    },
    close: async () => {
      await session.close()

      if (!options.gateway) {
        await stub.close()
        await gateway.server.close()
      }
    },
  }
}

export interface TestSession {
  readonly session: SessionService
  readonly commands: CommandsPort
  readonly runner: ShapeRunnerPort
  /** Closes the session and its gateway; fails when the session reported an error. */
  close(): Promise<void>
}

/**
 * A session with the command bus, as the root wires them, for feature tests: accounts at a
 * gateway without a network, each identity's own embedded database, synced through the stub.
 */
export async function openTestSession(logger: CommandLogger = silent): Promise<TestSession> {
  const world = await openTestWorld({ logger })

  return {
    session: world.session,
    commands: world.commands,
    runner: world.session.runner,
    close: async () => {
      await world.close()

      const [failure] = world.failures

      if (failure) {
        throw new Error(`the session reported ${failure.code}: ${failure.message}`)
      }
    },
  }
}
