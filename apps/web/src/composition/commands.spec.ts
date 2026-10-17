import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthUser, LocalDb, WritePathPort } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, profileIdFactory } from '@workspace/ids'
import { LoroWritePath, RegionDoc } from '@workspace/replica'
import { z } from '@workspace/zod'

import { profileCommands } from '../features/user/presentation/pages/profile/profile.model.gen'

import { type CommandLogger, createCommandBus } from './commands'
import { CurrentSpaceWritePath } from './current-space'

const user: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

let local: LocalDb
let region: RegionDoc
let logged: Array<Record<string, unknown>>

const logger: CommandLogger = {
  info: (fields) => logged.push({ level: 'info', ...fields }),
  warn: (fields) => logged.push({ level: 'warn', ...fields }),
}

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  region = (
    await RegionDoc.open(local, { kind: 'private', id: `identity:${user.id}` })
  )._unsafeUnwrap()
  logged = []
})

afterEach(async () => {
  expect((await region.flush()).isOk()).toBe(true)
  region.close()
  await local.close()
})

/** The bus as the root builds it, writing into the signed-in identity's region. */
const bus = (writePath: WritePathPort = new LoroWritePath(region, replicaSchema)) =>
  createCommandBus({ writePath, session: { current: () => user }, deviceId: 'dev-test', logger })

// What the write path records with each commit: who, which command, which flow.
const CommitMessage = z.strictObject({
  actor: z.string(),
  command: z.string(),
  correlationId: z.uuid(),
})

describe('createCommandBus', () => {
  it('runs a valid command as the signed-in user and records who wrote it', async () => {
    const messages: unknown[] = []

    region.doc.subscribePreCommit((event) => {
      messages.push(event.changeMeta.message)
    })

    const id = profileIdFactory.create()
    const result = await bus().execute(profileCommands.createProfile, {
      id,
      identity: user.id,
      name: 'Ann',
      email: 'ann@example.test',
    })

    expect(result.isOk()).toBe(true)
    expect(region.recordJson(`profile/${id}`)).toMatchObject({ name: 'Ann' })
    expect(CommitMessage.parse(JSON.parse(String(messages[0])))).toMatchObject({
      actor: user.id,
      command: 'user.profile.createProfile',
    })
  })

  it('refuses invalid parameters before anything is written', async () => {
    const result = await bus().execute(profileCommands.createProfile, {
      id: user.id as never,
      identity: user.id,
      name: 'Ann',
      email: 'ann@example.test',
    })

    expect(result._unsafeUnwrapErr().code).toBe('bus:INVALID_PAYLOAD')
    expect(region.records().size).toBe(0)
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

  it('reports a write refused while nobody is signed in', async () => {
    const result = await bus(new CurrentSpaceWritePath({ current: () => undefined })).execute(
      profileCommands.updateName,
      {
        id: profileIdFactory.create(),
        name: 'X',
      },
    )

    expect(result._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })
})
