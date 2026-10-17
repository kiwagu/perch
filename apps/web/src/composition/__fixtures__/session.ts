import type { DataError, LocalDb, ShapeRunnerPort } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import type { IdentityId } from '@workspace/ids'
import { leadership, lockName, syncHints } from '@workspace/replica/sync'
import {
  FakeLocks,
  type GatewayStub,
  gatewayStub,
  type ManualClock,
  manualClock,
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
}

/** A session as the root wires it, over embedded databases, the gateway stub and a manual clock. */
export interface TestWorld {
  readonly session: SessionService
  readonly commands: CommandsPort
  readonly auth: GatewayAuth
  readonly storage: MemoryStorage
  readonly stub: GatewayStub
  readonly clock: ManualClock
  /** What the session reported through `onError`. */
  readonly failures: DataError[]
  /** The sync states the session reported, oldest first. */
  readonly states: SyncState[]
  /** The identities whose databases were opened, in order. */
  opened(): IdentityId[]
  /** The identities whose databases were deleted, in order. */
  destroyed(): IdentityId[]
  /** The transport contexts the session handed out, newest last. */
  contexts(): readonly TransportContext[]
  /** Tells the session the tab went to the background or came back. */
  setVisibility(state: Visibility): void
  /** Moves the clock on until the promise settles, for waits the gateway does not end. */
  driveClock<T>(promise: PromiseLike<T>): Promise<T>
  close(): Promise<void>
}

const silent: CommandLogger = { info: () => {}, warn: () => {} }

export async function openTestWorld(options: TestWorldOptions = {}): Promise<TestWorld> {
  const clock = manualClock()
  const server = (await openTestDb())._unsafeUnwrap()
  const stub = gatewayStub({ local: server, schema: replicaSchema, clock })
  const storage = options.storage ?? memoryStorage()
  const auth = fakeGatewayAuth()
  const failures: DataError[] = []
  const states: SyncState[] = []
  const opened: IdentityId[] = []
  const destroyed: IdentityId[] = []
  const contexts: TransportContext[] = []
  const visibilityListeners = new Set<(state: Visibility) => void>()
  let visibility: Visibility = 'visible'
  const session = new SessionService({
    auth,
    openLocal: (identity) =>
      openTestDb().map((local): LocalDb => {
        opened.push(identity)

        const wrapped = options.wrap ? options.wrap(local) : local

        return {
          ...wrapped,
          destroy: async () => {
            destroyed.push(identity)
            await local.destroy()
          },
        }
      }),
    schema: replicaSchema,
    transport: (context) => {
      const transport = stub.transport(context.identity)

      contexts.push(context)
      // The browser's WebSocket transport calls `onEnded` itself; the stub tells its listeners.
      transport.onEnded(context.onEnded)

      if (options.online === false) {
        transport.goOffline()
      }

      return transport
    },
    // One tab: the lock is granted as soon as it is asked for.
    leadership: (identity) => leadership(new FakeLocks(), lockName(identity)),
    hints: () => syncHints(undefined),
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
    failures,
    states,
    opened: () => [...opened],
    destroyed: () => [...destroyed],
    contexts: () => [...contexts],
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
      await stub.close()
      await server.close()
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
