import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthUser, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { profileIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import { profileCommands } from '../features/user/presentation/pages/profile/profile.model.gen'
import { replicaSchema } from '../replica.schema.gen'

import { type CommandLogger, createCommandBus } from './commands'
import { SessionService } from './session'
import { memoryStorage } from './storage'

let local: LocalDb
let session: SessionService
let user: AuthUser
let logged: Array<Record<string, unknown>>

const logger: CommandLogger = {
  info: (fields) => logged.push({ level: 'info', ...fields }),
  warn: (fields) => logged.push({ level: 'warn', ...fields }),
}

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  logged = []
  session = new SessionService(local, {
    access: 'user',
    namespace: 'app',
    database: 'app',
    schema: replicaSchema,
    storage: memoryStorage(),
    onError: (error) => {
      throw new Error(error.message)
    },
  })
  user = (
    await session.signUp({ email: 'ann@example.test', password: 'secret-ann', name: 'Ann' })
  )._unsafeUnwrap()
})

afterEach(async () => {
  await local.close()
})

const bus = () =>
  createCommandBus({ writePath: session.writePath, session, deviceId: 'dev-test', logger })

// What the write path records with each commit: who, which command, which flow.
const CommitMessage = z.strictObject({
  actor: z.string(),
  command: z.string(),
  correlationId: z.uuid(),
})

describe('createCommandBus', () => {
  it('runs a valid command as the signed-in user and records who wrote it', async () => {
    const messages: unknown[] = []

    session.region()?.doc.subscribePreCommit((event) => {
      messages.push(event.changeMeta.message)
    })

    const id = profileIdFactory.create()
    const result = await bus().execute(profileCommands.createProfile, {
      id,
      user: user.id,
      name: 'Ann',
      email: 'ann@example.test',
    })

    expect(result.isOk()).toBe(true)
    expect(session.region()?.recordJson(`profile/${id}`)).toMatchObject({ name: 'Ann' })
    expect(CommitMessage.parse(JSON.parse(String(messages[0])))).toMatchObject({
      actor: user.id,
      command: 'user.profile.createProfile',
    })
  })

  it('refuses invalid parameters before anything is written', async () => {
    const result = await bus().execute(profileCommands.createProfile, {
      id: user.id as never,
      user: user.id,
      name: 'Ann',
      email: 'ann@example.test',
    })

    expect(result._unsafeUnwrapErr().code).toBe('bus:INVALID_PAYLOAD')
    expect(session.region()?.records().size).toBe(0)
  })

  it('logs every command with its outcome', async () => {
    const commands = bus()

    expect(
      (
        await commands.execute(profileCommands.updateName, {
          id: profileIdFactory.create(),
          name: 'X',
        })
      ).isErr(),
    ).toBe(true)

    expect(logged).toEqual([
      expect.objectContaining({
        level: 'warn',
        command: 'user.profile.updateName',
        outcome: 'data:WRITE_REJECTED',
        actor: user.id,
      }),
    ])
  })

  it('reports a write the region refuses', async () => {
    expect((await session.signOut()).isOk()).toBe(true)

    const result = await bus().execute(profileCommands.updateName, {
      id: profileIdFactory.create(),
      name: 'X',
    })

    expect(result._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })
})
