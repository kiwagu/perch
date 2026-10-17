import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser, DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, profileIdFactory } from '@workspace/ids'
import { leadership, lockName, syncHints } from '@workspace/replica/sync'
import {
  FakeHintChannel,
  FakeLocks,
  type GatewayStub,
  gatewayStub,
  type ManualClock,
  manualClock,
} from '@workspace/replica/testing'

import { profileCommands } from '../features/user/presentation/pages/profile/profile.model.gen'

import { createProfile, profileById } from './__fixtures__/profile'
import { type IdentitySpace, openIdentitySpace, type SyncState } from './identity-space'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

interface Gateway {
  readonly stub: GatewayStub
  readonly clock: ManualClock
  readonly server: LocalDb
}

/** One browser: the store its tabs share, the lock they compete for, the channel of their hints. */
interface Browser {
  readonly store: LocalDb
  readonly locks: FakeLocks | undefined
  readonly bus: Set<FakeHintChannel>
}

interface Tab {
  readonly space: IdentitySpace
  readonly states: SyncState[]
  readonly errors: DataError[]
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

async function openGateway(): Promise<Gateway> {
  const clock = manualClock()
  const server = (await openTestDb())._unsafeUnwrap()
  const stub = gatewayStub({ local: server, schema: replicaSchema, clock })

  cleanups.push(async () => {
    await stub.close()
    await server.close()
  })

  return { stub, clock, server }
}

async function openBrowser(options: { readonly locks?: boolean } = {}): Promise<Browser> {
  const store = (await openTestDb())._unsafeUnwrap()

  cleanups.push(() => store.close())

  return {
    store,
    locks: options.locks === false ? undefined : new FakeLocks(),
    bus: new Set(),
  }
}

/** A tab of the browser: its own view of the shared store, with its own change events, as each tab opens the store itself. */
async function openTab(gateway: Gateway, browser: Browser): Promise<Tab> {
  const states: SyncState[] = []
  const errors: DataError[] = []
  const view: LocalDb = {
    ...browser.store,
    changes: new EventTarget(),
    close: async () => {},
    destroy: async () => {},
  }
  const space = (
    await openIdentitySpace({
      identity: ann,
      openLocal: () => okAsync(view),
      schema: replicaSchema,
      transport: () => gateway.stub.transport(ann.id),
      leadership: browser.locks ? leadership(browser.locks, lockName(ann.id)) : undefined,
      hints: syncHints(new FakeHintChannel(browser.bus)),
      clock: gateway.clock,
      onState: (state) => states.push(state),
      onError: (error) => errors.push(error),
    })
  )._unsafeUnwrap()

  cleanups.push(() => space.close())

  return { space, states, errors }
}

const leading = (tab: Tab) => vi.waitFor(() => expect(tab.space.sync).toBeDefined())

const profile = (name: string) => ({
  id: profileIdFactory.create(),
  identity: ann.id,
  name,
  email: ann.email,
})

describe('openIdentitySpace', () => {
  it("opens the identity's own database and region", async () => {
    const gateway = await openGateway()
    const local = (await openTestDb())._unsafeUnwrap()
    const asked: string[] = []
    const space = (
      await openIdentitySpace({
        identity: ann,
        openLocal: (identity) => {
          asked.push(identity)

          return okAsync(local)
        },
        schema: replicaSchema,
        transport: () => gateway.stub.transport(ann.id),
        leadership: leadership(new FakeLocks(), lockName(ann.id)),
        hints: syncHints(undefined),
        clock: gateway.clock,
        onState: () => {},
        onError: (error) => expect.unreachable(error.message),
      })
    )._unsafeUnwrap()
    const written = profile('Ann')

    cleanups.push(() => space.close())

    expect(asked).toEqual([ann.id])
    expect(space.identity).toEqual(ann)
    expect((await space.writePath.run(createProfile, written)).isOk()).toBe(true)
    expect((await space.flush()).isOk()).toBe(true)
    expect(
      (await space.runner.read(profileById, { id: written.id }))._unsafeUnwrap(),
    ).toMatchObject({ name: 'Ann' })
    expect((await space.unsent())._unsafeUnwrap()).toBe(true)
  })

  it('runs the sync engine only while this tab leads', async () => {
    const gateway = await openGateway()
    const browser = await openBrowser()
    const first = await openTab(gateway, browser)
    const second = await openTab(gateway, browser)

    await leading(first)
    await vi.waitFor(() => expect(first.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    expect(second.space.sync).toBeUndefined()
    expect(second.states.at(-1)).toEqual({ leader: false, channel: 'down' })

    await first.space.close()

    await leading(second)
    expect(first.space.sync).toBeUndefined()
    expect(first.states.at(-1)).toEqual({ leader: false, channel: 'down' })
    await vi.waitFor(() => expect(second.states.at(-1)).toEqual({ leader: true, channel: 'up' }))
  })

  it('a follower imports what the leader wrote after a settled hint', async () => {
    const gateway = await openGateway()
    const browser = await openBrowser()
    const leader = await openTab(gateway, browser)
    const follower = await openTab(gateway, browser)
    const elsewhere = await openTab(gateway, await openBrowser())
    const written = profile('Ann')
    const seen: Array<string | undefined> = []

    await leading(leader)
    await leading(elsewhere)

    // The follower's own write comes first in the log, so its catch-up later reads it again.
    expect((await follower.space.writePath.run(createProfile, written)).isOk()).toBe(true)
    await vi.waitFor(async () =>
      expect(
        (await elsewhere.space.runner.read(profileById, { id: written.id }))._unsafeUnwrap(),
      ).toMatchObject({ name: 'Ann' }),
    )

    const stop = follower.space.runner.watch(profileById, { id: written.id }, (tree) =>
      seen.push(tree?.name),
    )

    await vi.waitFor(() => expect(seen).toContain('Ann'))

    // Another device writes; this browser's leader imports it and hints the follower, whose
    // own projection then announces the record to the follower's readers.
    expect(
      (
        await elsewhere.space.writePath.run(profileCommands.updateName, {
          id: written.id,
          name: 'Bea',
        })
      ).isOk(),
    ).toBe(true)

    await vi.waitFor(() => expect(seen.at(-1)).toBe('Bea'))
    stop()
    expect([...leader.errors, ...follower.errors, ...elsewhere.errors]).toEqual([])
  })

  it("a follower's write reaches the gateway through the leader", async () => {
    const gateway = await openGateway()
    const browser = await openBrowser()
    const leader = await openTab(gateway, browser)
    const follower = await openTab(gateway, browser)
    const elsewhere = await openTab(gateway, await openBrowser())
    const written = profile('Cid')

    await leading(leader)
    await leading(elsewhere)

    expect((await follower.space.writePath.run(createProfile, written)).isOk()).toBe(true)

    await vi.waitFor(async () =>
      expect(
        (await elsewhere.space.runner.read(profileById, { id: written.id }))._unsafeUnwrap(),
      ).toMatchObject({ name: 'Cid' }),
    )
    await vi.waitFor(async () =>
      expect((await follower.space.unsent())._unsafeUnwrap()).toBe(false),
    )
  })

  it('does not sync without Web Locks and says which capability is missing', async () => {
    const gateway = await openGateway()
    const tab = await openTab(gateway, await openBrowser({ locks: false }))

    expect(tab.space.sync).toBeUndefined()
    expect(tab.states).toEqual([{ leader: false, channel: 'down' }])
    expect(tab.errors.map((error) => error.code)).toEqual(['data:SYNC_STOPPED'])
    expect(tab.errors[0]?.message).toMatch(/Web Locks/)
  })

  it('destroy deletes the store', async () => {
    const gateway = await openGateway()
    const local = (await openTestDb())._unsafeUnwrap()
    const destroy = vi.spyOn(local, 'destroy')
    const space = (
      await openIdentitySpace({
        identity: ann,
        openLocal: () => okAsync(local),
        schema: replicaSchema,
        transport: () => gateway.stub.transport(ann.id),
        leadership: leadership(new FakeLocks(), lockName(ann.id)),
        hints: syncHints(undefined),
        clock: gateway.clock,
        onState: () => {},
        onError: (error) => expect.unreachable(error.message),
      })
    )._unsafeUnwrap()

    expect((await space.writePath.run(createProfile, profile('Ann'))).isOk()).toBe(true)

    await space.destroy()

    expect(destroy).toHaveBeenCalledOnce()
    expect(space.sync).toBeUndefined()
    expect((await space.runner.read(profileById, { id: profile('Ann').id })).isErr()).toBe(true)
  })
})
