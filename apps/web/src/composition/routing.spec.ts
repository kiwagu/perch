import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DataError, WritePathPort } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, noteIdFactory, profileIdFactory } from '@workspace/ids'

import { createNote, type NoteRow, organisationShape } from './__fixtures__/note'
import { createProfile, profileById } from './__fixtures__/profile'
import { RoutingShapeRunner, RoutingWritePath } from './routing'

const ann = identityIdFactory.create()

const note: NoteRow = { id: noteIdFactory.create(), author: ann, text: 'Hi' }

/** No other organisation ever becomes current. */
const unchanging = () => () => {}

/** Which organisation's runner is current, and a way for the test to make another one current. */
function currentTenant(first: FakeShapeRunner | undefined) {
  let current = first
  const listeners = new Set<() => void>()

  return {
    runner: () => current,
    onChange: (listener: () => void) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    becomes: (next: FakeShapeRunner | undefined) => {
      current = next

      for (const listener of [...listeners]) {
        listener()
      }
    },
    listening: () => listeners.size,
  }
}

/** A write path that only records the commands it was given. */
function recordingPath() {
  const ran: string[] = []
  const path: WritePathPort = {
    run: (command) => {
      ran.push(command.id)

      return okAsync(undefined)
    },
  }

  return { path, ran }
}

describe('RoutingShapeRunner', () => {
  it("reads a shape over the tenant region's tables from the current organisation's database", async () => {
    const own = new FakeShapeRunner()
    const tenant = new FakeShapeRunner().set(organisationShape, [note])
    const runner = new RoutingShapeRunner(own, () => tenant, replicaSchema, unchanging)

    expect((await runner.read(organisationShape, {}))._unsafeUnwrap()).toEqual([note])
    expect(own.lastParams(organisationShape)).toBeUndefined()
  })

  it("reads a shape over private tables from the identity's own database", async () => {
    const own = new FakeShapeRunner().set(profileById, { name: 'Ann' })
    const tenant = new FakeShapeRunner()
    const runner = new RoutingShapeRunner(own, () => tenant, replicaSchema, unchanging)
    const id = profileIdFactory.create()

    expect((await runner.read(profileById, { id }))._unsafeUnwrap()).toEqual({ name: 'Ann' })
    expect(tenant.lastParams(profileById)).toBeUndefined()
  })

  it('refuses a shape over the tenant region while no organisation is selected', async () => {
    const own = new FakeShapeRunner().set(organisationShape, [note])
    const runner = new RoutingShapeRunner(own, () => undefined, replicaSchema, unchanging)
    const reported: DataError[] = []

    const read = (await runner.read(organisationShape, {}))._unsafeUnwrapErr()
    const stop = runner.watch(organisationShape, {}, () => expect.unreachable('no tree'), {
      onError: (error) => reported.push(error),
    })

    stop()
    expect(read).toMatchObject({
      code: 'data:QUERY_FAILED',
      message: 'no organisation is selected',
    })
    expect(reported).toEqual([read])
    expect(own.watching(organisationShape)).toBe(0)
  })
})

describe('RoutingShapeRunner watch', () => {
  it('moves a watch over the tenant region to the organisation that becomes current, and reports once when none is', () => {
    const acme = new FakeShapeRunner().set(organisationShape, [note])
    const globex = new FakeShapeRunner().set(organisationShape, [])
    const tenant = currentTenant(acme)
    const runner = new RoutingShapeRunner(
      new FakeShapeRunner(),
      tenant.runner,
      replicaSchema,
      tenant.onChange,
    )
    const trees: Array<readonly NoteRow[]> = []
    const reported: DataError[] = []
    const stop = runner.watch(organisationShape, {}, (tree) => trees.push(tree), {
      onError: (error) => reported.push(error),
    })

    expect(trees).toEqual([[note]])

    tenant.becomes(globex)

    expect(acme.watching(organisationShape)).toBe(0)
    expect(globex.watching(organisationShape)).toBe(1)
    expect(trees).toEqual([[note], []])

    tenant.becomes(undefined)

    expect(globex.watching(organisationShape)).toBe(0)
    expect(reported.map((error) => error.message)).toEqual(['no organisation is selected'])

    tenant.becomes(acme)

    expect(trees.at(-1)).toEqual([note])
    expect(reported).toHaveLength(1)

    stop()

    expect(acme.watching(organisationShape)).toBe(0)
    expect(tenant.listening()).toBe(0)
  })

  it("leaves a watch over private tables on the identity's database whatever organisation is current", () => {
    const own = new FakeShapeRunner().set(profileById, { name: 'Ann' })
    const tenant = currentTenant(new FakeShapeRunner())
    const runner = new RoutingShapeRunner(own, tenant.runner, replicaSchema, tenant.onChange)
    const stop = runner.watch(profileById, { id: profileIdFactory.create() }, () => {})

    expect(own.watching(profileById)).toBe(1)
    expect(tenant.listening()).toBe(0)

    stop()

    expect(own.watching(profileById)).toBe(0)
  })
})

describe('RoutingWritePath', () => {
  it("runs a command into the tenant region on the current organisation's write path, any other on the identity's", async () => {
    const own = recordingPath()
    const tenant = recordingPath()
    const paths = new RoutingWritePath(own.path, () => tenant.path)
    const unrouted = new RoutingWritePath(own.path, () => undefined)
    const params = { id: noteIdFactory.create(), author: ann, text: 'Hi' }

    expect((await paths.run(createNote, params)).isOk()).toBe(true)
    expect(
      (
        await paths.run(createProfile, {
          id: profileIdFactory.create(),
          identity: ann,
          name: 'Ann',
          email: 'ann@example.test',
        })
      ).isOk(),
    ).toBe(true)
    expect((await unrouted.run(createNote, params))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'no organisation is selected',
    })
    expect(tenant.ran).toEqual([createNote.id])
    expect(own.ran).toEqual([createProfile.id])
  })
})
