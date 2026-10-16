import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'

import type { CommandsPort } from '../../platform/commands.port'
import { type CommandLogger, createCommandBus } from '../commands'
import { SessionService } from '../session'
import { memoryStorage } from '../storage'

export interface TestSession {
  readonly local: LocalDb
  readonly session: SessionService
  readonly commands: CommandsPort
}

const silent: CommandLogger = { info: () => {}, warn: () => {} }

/** An embedded database with the schema applied, a session over it and the command bus, as the root wires them. */
export async function openTestSession(logger: CommandLogger = silent): Promise<TestSession> {
  const local = (await openTestDb())._unsafeUnwrap()
  const session = new SessionService(local, {
    access: 'identity',
    namespace: 'app',
    database: 'app',
    schema: replicaSchema,
    storage: memoryStorage(),
    onError: (error) => {
      throw new Error(error.message)
    },
  })
  const commands = createCommandBus({
    writePath: session.writePath,
    session,
    deviceId: 'dev-test',
    logger,
  })

  return { local, session, commands }
}
