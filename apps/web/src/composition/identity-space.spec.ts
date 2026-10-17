import { okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type AuthUser, type DataError, type LocalDb, ShapeRunner } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import {
  type IdentityId,
  identityIdFactory,
  noteIdFactory,
  profileIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import type { ClientMessage, Membership } from '@workspace/replica/protocol'
import { leadership, lockName, type SyncTransport, syncHints } from '@workspace/replica/sync'
import {
  FakeHintChannel,
  FakeLocks,
  type GatewayStub,
  gatewayStub,
  type ManualClock,
  manualClock,
  type StubTransport,
} from '@workspace/replica/testing'

import { profileCommands } from '../features/user/presentation/pages/profile/profile.model.gen'

import { createNote, organisationShape } from './__fixtures__/note'
import { createProfile, profileById } from './__fixtures__/profile'
import {
  type IdentitySpace,
  openIdentitySpace,
  type SyncState,
  type TenantDatabaseInventory,
} from './identity-space'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

/** How long a test waits for the sync to settle; the manual clock never gets there on its own. */
const SETTLE_MS = 60_000

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
  /** The channels the tab's engines opened to the gateway, newest last. */
  readonly transports: StubTransport[]
}

/** The organisation databases a space opened and deleted, by key. */
interface TenantDatabases {
  readonly open: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  readonly opened: string[]
  readonly destroyed: string[]
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

/** The gateway stub, welcoming every device with `memberships`; its database projects both kinds of region. */
async function openGateway(memberships: readonly Membership[] = []): Promise<Gateway> {
  const clock = manualClock()
  const schema = `${readSchema('directory')}\n${readSchema('tenant')}`
  const server = (await openTestDb({ schema }))._unsafeUnwrap()
  const stub = gatewayStub({ local: server, schema: replicaSchema, clock, memberships })

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

/** Each organisation's database on its own in-memory engine, with the tenant schema. */
function tenantDatabases(): TenantDatabases {
  const opened: string[] = []
  const destroyed: string[] = []

  return {
    opened,
    destroyed,
    open: (_identity, key) =>
      openTestDb({ schema: readSchema('tenant'), database: 'tenant' }).map((local): LocalDb => {
        opened.push(key)

        return {
          ...local,
          destroy: async () => {
            destroyed.push(key)
            await local.destroy()
          },
        }
      }),
  }
}

/** An inventory of organisation databases in memory, holding `keys` to begin with. */
function inventory(keys: readonly string[] = []): TenantDatabaseInventory & {
  readonly held: Set<string>
} {
  const held = new Set(keys)

  return {
    held,
    keys: () => [...held].sort(),
    add: (added) => {
      for (const key of added) {
        held.add(key)
      }
    },
    drop: (dropped) => {
      for (const key of dropped) {
        held.delete(key)
      }
    },
  }
}

/** Passes everything through to `transport`, keeping what the device sent. */
function recording(transport: SyncTransport, sent: ClientMessage[]): SyncTransport {
  return {
    start: () => transport.start(),
    stop: () => transport.stop(),
    reconnect: () => transport.reconnect(),
    send: (message) => {
      sent.push(message)

      return transport.send(message)
    },
    onMessage: (listener) => transport.onMessage(listener),
    onChannel: (listener) => transport.onChannel(listener),
    onEnded: (listener) => transport.onEnded(listener),
  }
}

/** The regions a device subscribed to, in the order it asked. */
function subscribed(sent: readonly ClientMessage[] | undefined): string[] {
  return (sent ?? []).flatMap((message) => (message.type === 'subscribe' ? [message.region] : []))
}

/** A tab of the browser: its own view of the shared store, with its own change events, as each tab opens the store itself. */
async function openTab(gateway: Gateway, browser: Browser): Promise<Tab> {
  const states: SyncState[] = []
  const errors: DataError[] = []
  const transports: StubTransport[] = []
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
      openTenantLocal: tenantDatabases().open,
      deleteTenantLocal: () => okAsync(undefined),
      tenantDatabases: inventory(),
      memberships: [],
      tenant: undefined,
      schema: replicaSchema,
      transport: () => {
        const transport = gateway.stub.transport(ann.id)

        transports.push(transport)

        return transport
      },
      leadership: browser.locks ? leadership(browser.locks, lockName(ann.id)) : undefined,
      hints: syncHints(new FakeHintChannel(browser.bus)),
      clock: gateway.clock,
      onState: (state) => states.push(state),
      onError: (error) => errors.push(error),
    })
  )._unsafeUnwrap()

  cleanups.push(() => space.close())

  return { space, states, errors, transports }
}

/** A leading space of Ann's with `memberships`, the first by key current, its own store unless `local` is given. */
async function openSpace(
  gateway: Gateway,
  options: {
    readonly memberships: readonly Membership[]
    readonly online?: boolean
    readonly local?: LocalDb
    /** Opens the organisations' databases in place of `tenants`, which then opens none. */
    readonly openTenantLocal?: TenantDatabases['open']
    /** The organisation databases the device holds for Ann to begin with, by key. */
    readonly held?: readonly string[]
  },
) {
  const tenants = tenantDatabases()
  const errors: DataError[] = []
  const sent: ClientMessage[][] = []
  /** The organisation databases deleted while not open, by key. */
  const deleted: string[] = []
  const held = inventory(options.held)
  const space = (
    await openIdentitySpace({
      identity: ann,
      openLocal: () => (options.local ? okAsync(options.local) : openTestDb()),
      openTenantLocal: options.openTenantLocal ?? tenants.open,
      deleteTenantLocal: (_identity, key) => {
        deleted.push(key)

        return okAsync(undefined)
      },
      tenantDatabases: held,
      memberships: options.memberships,
      tenant: undefined,
      schema: replicaSchema,
      transport: () => {
        const transport = gateway.stub.transport(ann.id)
        const mine: ClientMessage[] = []

        sent.push(mine)

        if (options.online === false) {
          transport.goOffline()
        }

        return recording(transport, mine)
      },
      leadership: leadership(new FakeLocks(), lockName(ann.id)),
      hints: syncHints(undefined),
      clock: gateway.clock,
      onState: () => {},
      onError: (error) => errors.push(error),
    })
  )._unsafeUnwrap()

  cleanups.push(() => space.close())
  await vi.waitFor(() => expect(space.sync).toBeDefined())

  return { space, tenants, errors, sent, deleted, inventory: held.held }
}

/** Waits until the leader's engine has nothing left to send or hear. */
async function settled(space: IdentitySpace): Promise<void> {
  await (space.sync ?? expect.unreachable('the space leads')).settled(SETTLE_MS)
}

const aNote = (text: string) => ({ id: noteIdFactory.create(), author: ann.id, text })

/** The head of a region on the gateway: how many batches it accepted into it. */
async function headOf(gateway: Gateway, region: string): Promise<number | undefined> {
  return (await gateway.stub.hub.heads([region]))._unsafeUnwrap()[0]?.head
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
        openTenantLocal: tenantDatabases().open,
        deleteTenantLocal: () => okAsync(undefined),
        tenantDatabases: inventory(),
        memberships: [],
        tenant: undefined,
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
        openTenantLocal: tenantDatabases().open,
        deleteTenantLocal: () => okAsync(undefined),
        tenantDatabases: inventory(),
        memberships: [],
        tenant: undefined,
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

describe('organisations in the identity space', () => {
  it('opens a database per membership and syncs its region alongside the private one', async () => {
    const gateway = await openGateway([acme])
    const { space, tenants, errors, sent } = await openSpace(gateway, { memberships: [acme] })
    const written = aNote('Hello')

    await settled(space)

    expect(tenants.opened).toEqual(['acme'])
    expect(space.tenants()).toEqual(['acme'])
    expect(space.currentTenant()).toBe('acme')
    expect(subscribed(sent.at(-1))).toEqual([`identity:${ann.id}`, 'tenant:acme'])

    expect((await space.writePath.run(createNote, written)).isOk()).toBe(true)
    await settled(space)

    expect((await space.runner.read(organisationShape, {}))._unsafeUnwrap()).toMatchObject([
      { id: written.id, author: ann.id, text: 'Hello' },
    ])
    expect(await headOf(gateway, 'tenant:acme')).toBe(1)
    expect(
      (await new ShapeRunner(gateway.server).read(organisationShape, {}))._unsafeUnwrap(),
    ).toMatchObject([{ id: written.id, author: ann.id, text: 'Hello' }])
    expect(errors).toEqual([])
  })

  it('setMemberships with a new organisation opens its database and the engine syncs it', async () => {
    const gateway = await openGateway([acme, globex])
    const { space, tenants, errors, sent } = await openSpace(gateway, { memberships: [acme] })

    await settled(space)

    const before = space.sync

    await space.setMemberships([acme, globex])

    expect(tenants.opened).toEqual(['acme', 'globex'])
    expect(space.tenants()).toEqual(['acme', 'globex'])
    expect(space.currentTenant()).toBe('acme')
    expect(space.sync).toBeDefined()
    expect(space.sync).not.toBe(before)

    space.selectTenant('globex')

    expect(space.currentTenant()).toBe('globex')
    expect((await space.writePath.run(createNote, aNote('Hi Globex'))).isOk()).toBe(true)
    await settled(space)

    expect(subscribed(sent.at(-1))).toEqual([`identity:${ann.id}`, 'tenant:acme', 'tenant:globex'])
    expect(await headOf(gateway, 'tenant:globex')).toBe(1)
    expect(await headOf(gateway, 'tenant:acme')).toBe(0)
    expect(errors).toEqual([])
  })

  it('setMemberships without an organisation closes and deletes its database and stops syncing it', async () => {
    const gateway = await openGateway([acme])
    const { space, tenants, errors, sent } = await openSpace(gateway, { memberships: [acme] })

    await settled(space)
    await space.setMemberships([])

    expect(tenants.destroyed).toEqual(['acme'])
    expect(space.tenants()).toEqual([])
    expect(space.currentTenant()).toBeUndefined()

    await settled(space)

    expect(subscribed(sent.at(-1))).toEqual([`identity:${ann.id}`])
    expect((await space.runner.read(organisationShape, {}))._unsafeUnwrapErr().message).toBe(
      'no organisation is selected',
    )
    expect(errors).toEqual([])
  })

  it('reports a change of memberships that fails, runs the next one and still closes', async () => {
    const gateway = await openGateway([acme])
    const tenants = tenantDatabases()
    const failure = new Error('the browser would not open the database')
    const { space, errors } = await openSpace(gateway, {
      memberships: [],
      openTenantLocal: (identity, key) =>
        key === 'globex'
          ? new ResultAsync<LocalDb, DataError>(Promise.reject(failure))
          : tenants.open(identity, key),
    })

    await space.setMemberships([globex])

    expect(errors.map(({ code, cause }) => [code, cause])).toEqual([['data:OPEN_FAILED', failure]])
    expect(space.tenants()).toEqual([])

    await space.setMemberships([acme])

    expect(tenants.opened).toEqual(['acme'])
    expect(space.tenants()).toEqual(['acme'])
    await expect(space.close()).resolves.toBeUndefined()
  })

  it('destroy deletes the private database and every tenant database', async () => {
    const gateway = await openGateway([acme, globex])
    const local = (await openTestDb())._unsafeUnwrap()
    const destroy = vi.spyOn(local, 'destroy')
    const { space, tenants } = await openSpace(gateway, { memberships: [acme, globex], local })

    await space.destroy()

    expect(destroy).toHaveBeenCalledOnce()
    expect([...tenants.destroyed].sort()).toEqual(['acme', 'globex'])
    expect(space.sync).toBeUndefined()
  })

  it('counts the databases it opens, and deletes those the device holds of organisations the identity left', async () => {
    const gateway = await openGateway([acme, globex])
    const { space, deleted, inventory, errors } = await openSpace(gateway, {
      memberships: [acme],
      held: ['globex', 'initech'],
    })

    // Globex and Initech were kept from an earlier session: Ann no longer belongs to them.
    await vi.waitFor(() => expect([...deleted].sort()).toEqual(['globex', 'initech']))
    expect([...inventory]).toEqual(['acme'])

    await space.setMemberships([acme, globex])

    expect([...inventory].sort()).toEqual(['acme', 'globex'])

    await space.setMemberships([globex])

    // Acme was open: the space deleted it itself, not as a database it does not hold open.
    expect(deleted).toEqual(['globex', 'initech'])
    expect([...inventory]).toEqual(['globex'])
    expect(errors).toEqual([])
  })

  it('destroy deletes the databases the device holds that are not open, and counts none any more', async () => {
    const gateway = await openGateway([acme])
    const failure = new Error('the browser would not open the database')
    const tenants = tenantDatabases()
    const { space, deleted, inventory, errors } = await openSpace(gateway, {
      memberships: [acme],
      openTenantLocal: (identity, key) =>
        key === 'globex'
          ? new ResultAsync<LocalDb, DataError>(Promise.reject(failure))
          : tenants.open(identity, key),
    })

    // Globex's database does not open: it is no open space, yet the device may hold it.
    await space.setMemberships([acme, globex])
    expect(errors.splice(0).map(({ code }) => code)).toEqual(['data:OPEN_FAILED'])
    expect(space.tenants()).toEqual(['acme'])

    await space.destroy()

    expect(tenants.destroyed).toEqual(['acme'])
    expect(deleted).toEqual(['globex'])
    expect([...inventory]).toEqual([])
  })

  it('unsent counts the outbox of every region', async () => {
    const gateway = await openGateway([acme])
    const { space } = await openSpace(gateway, { memberships: [acme], online: false })

    expect((await space.unsent())._unsafeUnwrap()).toBe(false)
    expect((await space.writePath.run(createNote, aNote('Offline'))).isOk()).toBe(true)
    expect((await space.unsent())._unsafeUnwrap()).toBe(true)
  })

  it('a watch over the tenant region follows the current organisation and leaves one the identity left', async () => {
    const gateway = await openGateway([acme, globex])
    const { space, errors } = await openSpace(gateway, {
      memberships: [acme, globex],
      online: false,
    })
    const trees: string[][] = []
    const reported: DataError[] = []

    expect((await space.writePath.run(createNote, aNote('At Acme'))).isOk()).toBe(true)
    space.selectTenant('globex')
    expect((await space.writePath.run(createNote, aNote('At Globex'))).isOk()).toBe(true)
    space.selectTenant('acme')

    const stop = space.runner.watch(
      organisationShape,
      {},
      (tree) => trees.push(tree.map(({ text }) => text)),
      { onError: (error) => reported.push(error) },
    )

    await vi.waitFor(() => expect(trees.at(-1)).toEqual(['At Acme']))

    space.selectTenant('globex')
    await vi.waitFor(() => expect(trees.at(-1)).toEqual(['At Globex']))

    // Globex, current, is left: the watch moves to Acme before Globex's database goes.
    await space.setMemberships([acme])
    await vi.waitFor(() => expect(trees.at(-1)).toEqual(['At Acme']))

    await space.setMemberships([])

    expect(reported.map((error) => error.message)).toEqual(['no organisation is selected'])

    stop()
    expect(errors).toEqual([])
  })

  it('a watch started while no organisation is current reports it once and starts on the first one', async () => {
    const gateway = await openGateway([acme])
    const { space, errors } = await openSpace(gateway, { memberships: [], online: false })
    const trees: string[][] = []
    const reported: DataError[] = []
    const stop = space.runner.watch(
      organisationShape,
      {},
      (tree) => trees.push(tree.map(({ text }) => text)),
      { onError: (error) => reported.push(error) },
    )

    expect(reported.map((error) => error.message)).toEqual(['no organisation is selected'])

    await space.setMemberships([acme])

    expect(space.currentTenant()).toBe('acme')
    await vi.waitFor(() => expect(trees.at(-1)).toEqual([]))
    expect((await space.writePath.run(createNote, aNote('First'))).isOk()).toBe(true)
    await vi.waitFor(() => expect(trees.at(-1)).toEqual(['First']))
    expect(reported).toHaveLength(1)

    stop()
    expect(errors).toEqual([])
  })

  it('reconnectSync has the leader connect again, and so does a renew hint from another tab', async () => {
    const gateway = await openGateway()
    const browser = await openBrowser()
    const leader = await openTab(gateway, browser)
    const follower = await openTab(gateway, browser)

    await leading(leader)
    await vi.waitFor(() => expect(leader.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    leader.space.reconnectSync()
    // A follower has no channel of its own to connect again.
    follower.space.reconnectSync()

    expect(leader.transports.map((transport) => transport.reconnects())).toEqual([1])
    expect(follower.transports).toEqual([])

    syncHints(new FakeHintChannel(browser.bus)).post('renew')

    expect(leader.transports.map((transport) => transport.reconnects())).toEqual([2])
    expect([...leader.errors, ...follower.errors]).toEqual([])
  })
})
