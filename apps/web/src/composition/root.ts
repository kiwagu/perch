/**
 * The composition root: the only module of the application that imports
 * adapters. It opens the local database, restores the session and binds each
 * port to its token; everything below receives ports only.
 */

import type { ResultAsync } from 'neverthrow'

import {
  type DataError,
  type Engines,
  LOCAL_DB,
  openLocalDb,
  SHAPE_RUNNER,
  ShapeRunner,
  type ShapeRunnerPort,
  WRITE_PATH,
  type WritePathPort,
} from '@workspace/data'
import { Container } from '@workspace/di'

import { COMMANDS, type CommandsPort } from '../platform/commands.port'
import { SESSION, type SessionPort } from '../platform/session.port'
import { replicaSchema } from '../replica.schema.gen'

import { type CommandLogger, createCommandBus } from './commands'
import { SessionService } from './session'
import { deviceIdFrom, type KeyValueStorage } from './storage'

export type BootStep = 'open-db' | 'restore-session' | 'ready'

export interface AppRootOptions {
  readonly engines: Engines
  readonly url: string
  readonly schema: string
  readonly storage: KeyValueStorage
  readonly logger: CommandLogger
  readonly onStep?: (step: BootStep) => void
  readonly onError: (error: DataError) => void
}

/** What the application receives: ports, and the container that resolves them. */
export interface AppServices {
  readonly container: Container
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly session: SessionPort
  readonly commands: CommandsPort
  close(): Promise<void>
}

export const NAMESPACE = 'app'

export const DATABASE = 'app'

export function createAppRoot(options: AppRootOptions): ResultAsync<AppServices, DataError> {
  const step = (name: BootStep): void => options.onStep?.(name)

  step('open-db')

  return openLocalDb({
    engines: options.engines,
    url: options.url,
    namespace: NAMESPACE,
    database: DATABASE,
    schema: options.schema,
  }).andThen((local) => {
    const session = new SessionService(local, {
      access: 'user',
      namespace: NAMESPACE,
      database: DATABASE,
      schema: replicaSchema,
      storage: options.storage,
      onError: options.onError,
    })
    const runner = new ShapeRunner(local)
    const commands = createCommandBus({
      writePath: session.writePath,
      session,
      deviceId: deviceIdFrom(options.storage),
      logger: options.logger,
    })
    const container = new Container()
      .singleton(LOCAL_DB, () => local)
      .singleton(SHAPE_RUNNER, () => runner)
      .singleton(WRITE_PATH, () => session.writePath)
      .singleton(SESSION, () => session)
      .singleton(COMMANDS, () => commands)

    step('restore-session')

    return session.restore().map(() => {
      step('ready')

      return {
        container,
        runner,
        writePath: session.writePath,
        session,
        commands,
        close: () => local.close(),
      }
    })
  })
}
