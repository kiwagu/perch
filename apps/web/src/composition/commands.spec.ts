import { errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type EventBus, fakeEventBus } from '@workspace/cqrs'
import type { AuthUser, DataError, LocalDb, WritePathPort } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, profileIdFactory } from '@workspace/ids'
import { LoroWritePath, RegionDoc } from '@workspace/replica'
import { z } from '@workspace/zod'

import { profileCommands } from '../features/user/presentation/pages/profile/profile.model.gen'
import type { AppEvent } from '../platform/events.port'

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
const bus = (
  writePath: WritePathPort = new LoroWritePath(region, replicaSchema),
  events: Pick<EventBus<AppEvent>, 'publish'> = fakeEventBus<AppEvent>().bus,
) =>
  createCommandBus({
    writePath,
    session: { current: () => user },
    deviceId: 'dev-test',
    logger,
    events,
  })

/** A write path whose write waits until the test releases it, once it has started. */
function heldWritePath() {
  let release: () => void = () => {}
  let begin: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    begin = resolve
  })
  const writePath: WritePathPort = {
    run: () =>
      new ResultAsync(
        new Promise<Result<void, DataError>>((done) => {
          release = () => done(ok(undefined))
          begin()
        }),
      ),
  }

  return { writePath, started, release: () => release() }
}

const newProfile = () => ({
  id: profileIdFactory.create(),
  identity: user.id,
  name: 'Ann',
  email: 'ann@example.test',
})

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
    const result = await bus(
      new CurrentSpaceWritePath({
        current: () => undefined,
        opening: () => undefined,
        signingOut: () => false,
        writing: (_space, work) => work(),
      }),
    ).execute(profileCommands.updateName, {
      id: profileIdFactory.create(),
      name: 'X',
    })

    expect(result._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })

  it('publishes the command done once its write resolved, never before', async () => {
    const fake = fakeEventBus<AppEvent>()
    const held = heldWritePath()
    const params = newProfile()
    const outcome = bus(held.writePath, fake.bus).execute(profileCommands.createProfile, params)

    await held.started

    expect(fake.published).toEqual([])

    held.release()

    expect((await outcome).isOk()).toBe(true)
    expect(fake.published).toEqual([
      expect.objectContaining({
        name: 'user.profile.createProfile.done',
        payload: { params },
        actorId: user.id,
      }),
    ])
  })

  it('publishes the command failed with its error', async () => {
    const fake = fakeEventBus<AppEvent>()
    const result = await bus(undefined, fake.bus).execute(profileCommands.updateName, {
      id: profileIdFactory.create(),
      name: 'X',
    })

    const [failed, ...more] = fake.published

    expect(result.isErr()).toBe(true)
    expect(more).toEqual([])
    expect(failed?.name).toBe('user.profile.updateName.failed')
    expect(failed?.payload).toMatchObject({ error: { code: 'data:WRITE_REJECTED' } })
  })

  it('publishes nothing for parameters refused before the write', async () => {
    const fake = fakeEventBus<AppEvent>()
    const result = await bus(undefined, fake.bus).execute(profileCommands.createProfile, {
      ...newProfile(),
      id: user.id as never,
    })

    expect(result._unsafeUnwrapErr().code).toBe('bus:INVALID_PAYLOAD')
    expect(fake.published).toEqual([])
  })

  it('keeps the result of a command whose subscribers fail, and logs what each said', async () => {
    const fake = fakeEventBus<AppEvent>()

    fake.bus.onAny(() => errAsync({ code: 'test:BROKEN' }))
    fake.bus.onAny(() => {
      throw new Error('subscriber bug')
    })

    const result = await bus(undefined, fake.bus).execute(
      profileCommands.createProfile,
      newProfile(),
    )
    const warned = logged.find(({ event }) => event === 'user.profile.createProfile.done')

    expect(result.isOk()).toBe(true)
    expect(warned).toEqual({
      level: 'warn',
      event: 'user.profile.createProfile.done',
      outcome: 'bus:SUBSCRIBER_FAILED',
      causes: [
        { code: 'test:BROKEN' },
        { code: 'bus:SUBSCRIBER_THREW', message: 'Error: subscriber bug' },
      ],
    })
  })
})
