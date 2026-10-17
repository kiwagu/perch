import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { createAuth, type DataError, dataError, openLocalDb, tenantDatabase } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, noteIdFactory, profileIdFactory, tenantIdFactory } from '@workspace/ids'
import { NO_ABILITY, OWNER_ABILITY } from '@workspace/kernel'
import { createLogger } from '@workspace/logger'
import { RegionDoc } from '@workspace/replica'
import {
  CLOSE,
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  MAX_PUSH_UPDATES,
  type Membership,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'
import { RegionHub } from '@workspace/replica/server'
import { manualClock } from '@workspace/replica/testing'

import { type DeviceTokens, IdentitySessions } from '../auth/identity-sessions'
import { DIRECTORY, NAMESPACE } from '../config'
import { Organisations } from '../tenants/organisations'
import { regionDatabases } from '../tenants/region-databases'
import memberRemoveStatement from '../tenants/surql/member-remove.surql'
import membershipRemoveStatement from '../tenants/surql/membership-remove.surql'
import membershipsOfStatement from '../tenants/surql/memberships-of.surql'
import { TenantDatabases } from '../tenants/tenant-databases'

import { noteCreate, noteUpdate } from './__fixtures__/note'
import { profileCreate } from './__fixtures__/profile'
import { ConnectionRegistry } from './connections'
import {
  regionsFor,
  type SocketLike,
  SyncConnection,
  type SyncConnectionDeps,
} from './sync-connection'

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

const bob = { email: 'bob@example.test', password: 'pass-word-1' }

/** The close code of a server that failed. */
const SERVER_ERROR = 1011

/** A socket that records what the connection sent it, decoded, and how it was closed. */
class FakeSocket implements SocketLike {
  readonly sent: ServerMessage[] = []
  readonly closes: Array<readonly [number, string]> = []

  get closedWith(): readonly [number, string] | undefined {
    return this.closes[0]
  }

  send(text: string): void {
    this.sent.push(decodeMessage(serverMessage, text)._unsafeUnwrap())
  }

  close(code: number, reason: string): void {
    this.closes.push([code, reason])
  }
}

/** Closes what each test opened: the hub, then the organisations' databases, then the directory. */
const cleanups: Array<() => Promise<void>> = []

/** Failures the hub, the identity sessions or the connection reported; a test that expects one takes it. */
const reported: DataError[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }

  expect(reported.splice(0)).toEqual([])
})

function encode(message: ClientMessage): string {
  return encodeMessage(clientMessage, message)
}

/** A hello of the protocol before this one, which the encoder of this one cannot write. */
function helloOfProtocol1({ access, refresh }: DeviceTokens): string {
  return JSON.stringify({ type: 'hello', protocol: 1, access, refresh })
}

function types(messages: readonly ServerMessage[]): string[] {
  return messages.map((message) => message.type)
}

interface ConnectOptions {
  /** Replaces hub calls, to make them fail. */
  readonly hub?: Partial<SyncConnectionDeps['hub']>
  /** Answers the revoke of a grant; it succeeds by default. */
  readonly revoke?: SyncConnectionDeps['sessions']['revoke']
  /** Runs once the keys were checked, before the connection hears the outcome. */
  readonly onAuthenticated?: () => void
}

interface GatewayOptions {
  /** Runs before each query sent to an organisation's database; it may throw to make the query fail. */
  readonly tenantQueries?: (text: string) => void
  /** Runs before each query the organisations send to the directory; it may throw to make the query fail. */
  readonly directoryQueries?: (text: string) => void
}

/**
 * The gateway's services on a fresh embedded directory, each organisation's database on an
 * embedded engine of its own: identity sessions, organisations, a real hub over both, and the
 * registry of connections, which hears every change of memberships as the composition root
 * wires it. Revoking a grant goes to the database's RPC over HTTP, so a connection only counts it.
 */
async function openGateway(options: GatewayOptions = {}) {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()
  const clock = manualClock()
  const databases = new TenantDatabases({
    open: (key) =>
      openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: NAMESPACE,
        database: tenantDatabase(key),
        schema: readSchema('tenant'),
      }).map((tenant) =>
        options.tenantQueries ? interceptQueries(tenant, options.tenantQueries) : tenant,
      ),
    clock: manualClock(),
    onError: (error) => reported.push(error),
  })
  const hub = new RegionHub({
    databases: regionDatabases(local, databases),
    schema: replicaSchema,
    clock,
    onError: (error) => reported.push(error),
  })

  cleanups.push(async () => {
    await hub.close()
    await databases.close()
    await local.close()
  })

  const sessions = new IdentitySessions({
    openAuth: () =>
      createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
    rpcUrl: 'http://127.0.0.1:8000/rpc',
    fetch: Object.assign(() => Promise.reject(new TypeError('no network in this test')), {
      preconnect: () => {},
    }),
    onCloseFailure: (error) => reported.push(error),
  })
  const connections = new ConnectionRegistry()
  const organisations = new Organisations({
    directory: options.directoryQueries ? interceptQueries(local, options.directoryQueries) : local,
    databases,
    revoke: (identity, region) => connections.revoke(identity, region),
  })

  organisations.onChange((identity, memberships) => connections.tell(identity, memberships))

  return {
    clock,
    hub,
    sessions,
    organisations,
    connections,
    signUp: async (credentials: typeof ann) => (await sessions.signUp(credentials))._unsafeUnwrap(),
  }
}

type Gateway = Awaited<ReturnType<typeof openGateway>>

/** A connection of a device to the gateway over a fake socket; it has not said hello yet. */
function open(gateway: Gateway, options: ConnectOptions = {}) {
  const { hub, sessions } = gateway
  const revoked: DeviceTokens[] = []
  const logLines: string[] = []
  /** The regions the connection left at the hub, in order. */
  const unsubscribed: string[] = []
  const socket = new FakeSocket()
  const connection = new SyncConnection(socket, {
    sessions: {
      authenticate: (tokens) =>
        sessions.authenticate(tokens).andTee(() => options.onAuthenticated?.()),
      revoke: (tokens) => {
        revoked.push(tokens)

        return options.revoke ? options.revoke(tokens) : okAsync(undefined)
      },
    },
    hub: {
      subscribe: hub.subscribe.bind(hub),
      unsubscribe: (region, subscriber) => {
        unsubscribed.push(region)
        hub.unsubscribe(region, subscriber)
      },
      pull: hub.pull.bind(hub),
      push: hub.push.bind(hub),
      heads: hub.heads.bind(hub),
      compact: hub.compact.bind(hub),
      ...options.hub,
    },
    organisations: gateway.organisations,
    schema: replicaSchema,
    connections: gateway.connections,
    clock: gateway.clock,
    log: createLogger('sync', {
      level: 'info',
      format: 'json',
      destination: { write: (line) => logLines.push(line) },
    }),
    onError: (error) => reported.push(error),
  })

  return { socket, connection, revoked, logLines, unsubscribed }
}

/**
 * Holds the hub calls passed through it while held, as a slow hub would; `hold` answers a
 * promise that resolves once a call waits.
 */
function holding() {
  let gate: Promise<void> | undefined
  let open = () => {}
  let arrived = () => {}

  return {
    hold: (): Promise<void> => {
      gate = new Promise((resolve) => {
        open = resolve
      })

      return new Promise((resolve) => {
        arrived = resolve
      })
    },
    release: () => {
      gate = undefined
      open()
    },
    through: <T>(call: () => ResultAsync<T, DataError>): ResultAsync<T, DataError> => {
      if (!gate) {
        return call()
      }

      arrived()

      return ResultAsync.fromSafePromise(gate).andThen(call)
    },
  }
}

/** A connection whose probes and hello wait while `heads` holds them. */
function openHolding(gateway: Gateway, heads: ReturnType<typeof holding>) {
  return open(gateway, {
    hub: { heads: (regions) => heads.through(() => gateway.hub.heads(regions)) },
  })
}

/** The update that creates a note of `author` in a device's copy of the region of Acme. */
async function acmeNote(author: string, text: string): Promise<Uint8Array<ArrayBuffer>> {
  return (
    await noteCreate(RegionDoc.inMemory('tenant', 'tenant:acme'), {
      id: noteIdFactory.create(),
      author,
      text,
    })
  )._unsafeUnwrap()
}

/** Says hello with a pair the gateway gave at sign-up or sign-in. */
function hello(connection: SyncConnection, { access, refresh }: DeviceTokens): Promise<void> {
  return connection.receive(encode({ type: 'hello', protocol: PROTOCOL_VERSION, access, refresh }))
}

/** A gateway where Ann has signed up, and a connection to it that has not said hello yet. */
async function connect(options: ConnectOptions = {}) {
  const gateway = await openGateway()
  const signedUp = await gateway.signUp(ann)

  return {
    ...gateway,
    ...open(gateway, options),
    ann: signedUp,
    region: `identity:${signedUp.identity.id}`,
  }
}

/** A connection where Ann said hello with the pair her sign-up gave her. */
async function connectedAsAnn(options: ConnectOptions = {}) {
  const fixture = await connect(options)

  await hello(fixture.connection, fixture.ann.tokens)

  return { ...fixture, doc: RegionDoc.inMemory('private', fixture.region) }
}

/**
 * A gateway where Ann and Bob have signed up and Ann has created the organisation Acme;
 * Bob belongs to it when `bobInvited`.
 */
async function withAcme(bobInvited: boolean, options: GatewayOptions = {}) {
  const gateway = await openGateway(options)
  const anns = await gateway.signUp(ann)
  const bobs = await gateway.signUp(bob)
  const acme = (
    await gateway.organisations.create({ identity: anns.identity.id, key: 'acme', name: 'Acme' })
  )._unsafeUnwrap()

  if (bobInvited) {
    ;(
      await gateway.organisations.invite({ actor: anns.identity.id, key: 'acme', email: bob.email })
    )._unsafeUnwrap()
  }

  return { gateway, anns, bobs, acme }
}

/** The update that creates Ann's profile in her device's document. */
async function annProfile(doc: RegionDoc, identity: string): Promise<Uint8Array<ArrayBuffer>> {
  return (
    await profileCreate(doc, {
      id: profileIdFactory.create(),
      identity,
      name: 'Ann',
      email: ann.email,
    })
  )._unsafeUnwrap()
}

describe('SyncConnection', () => {
  it('closes a socket that speaks before saying hello', async () => {
    const { socket, connection } = await connect()

    await connection.receive(encode({ type: 'probe', regions: [] }))

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
    expect(socket.closedWith?.[1].length).toBeGreaterThan(0)
    expect(socket.closedWith?.[1].length).toBeLessThanOrEqual(120)
    expect(socket.sent).toEqual([])
  })

  it('closes with unauthorized when the keys are not accepted', async () => {
    const { socket, connection } = await connect()

    await connection.receive(
      encode({ type: 'hello', protocol: PROTOCOL_VERSION, access: 'garbage' }),
    )

    expect(socket.closedWith?.[0]).toBe(CLOSE.unauthorized)
    expect(socket.sent).toEqual([])
  })

  it('welcomes a device with its private region and sends renewed keys', async () => {
    const { socket, connection, ann, clock } = await connect()

    await clock.advance(1_000)
    await connection.receive(
      encode({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        access: 'stale',
        refresh: ann.tokens.refresh,
      }),
    )

    const [tokens, welcome, ...more] = socket.sent
    const renewed = tokens?.type === 'tokens' ? tokens : expect.unreachable('renewed keys first')

    expect(more).toEqual([])
    expect(renewed.access).not.toBe(ann.tokens.access)
    expect(renewed.refresh).not.toBe(ann.tokens.refresh)
    expect(welcome).toEqual({
      type: 'welcome',
      identity: ann.identity.id,
      regions: [{ region: `identity:${ann.identity.id}`, head: 0 }],
      memberships: [],
      time: 1_000,
    })
    expect(socket.closedWith).toBeUndefined()
    // The hello timer is gone with the hello.
    expect(clock.pending()).toBe(0)
  })

  it("refuses a region that is not the identity's own", async () => {
    const { socket, connection } = await connectedAsAnn()

    await connection.receive(
      encode({ type: 'subscribe', region: 'identity:idn_someone_else', vv: null }),
    )

    expect(socket.sent.at(-1)).toEqual(
      expect.objectContaining({ type: 'error', code: 'forbidden-region' }),
    )
    expect(socket.closedWith?.[0]).toBe(CLOSE.forbidden)
  })

  it.each<{ readonly name: string; readonly message: (own: string) => ClientMessage }>([
    {
      name: 'a pull',
      message: () => ({ type: 'pull', region: 'identity:idn_x', vv: new Uint8Array() }),
    },
    {
      name: 'a push',
      message: () => ({
        type: 'push',
        region: 'identity:idn_x',
        batch: 1,
        updates: [new Uint8Array(1)],
      }),
    },
    {
      name: 'a compaction',
      message: () => ({
        type: 'compact',
        region: 'identity:idn_x',
        covers: 0,
        snapshot: new Uint8Array(1),
      }),
    },
    { name: 'a probe', message: (own) => ({ type: 'probe', regions: [own, 'identity:idn_x'] }) },
  ])("refuses $name naming a region that is not the identity's own", async ({ message }) => {
    const { socket, connection, region } = await connectedAsAnn()

    await connection.receive(encode(message(region)))

    expect(types(socket.sent)).toEqual(['welcome', 'error'])
    expect(socket.closedWith?.[0]).toBe(CLOSE.forbidden)
  })

  it('subscribes, accepts a push and answers a probe', async () => {
    const { socket, connection, region, doc, ann } = await connectedAsAnn()

    await connection.receive(encode({ type: 'subscribe', region, vv: null }))
    await connection.receive(
      encode({ type: 'push', region, batch: 1, updates: [await annProfile(doc, ann.identity.id)] }),
    )
    await connection.receive(encode({ type: 'probe', regions: [region] }))

    expect(types(socket.sent)).toEqual(['welcome', 'updates', 'ack', 'heads'])
    expect(socket.sent[2]).toEqual(expect.objectContaining({ type: 'ack', batch: 1, head: 1 }))
    expect(socket.sent[3]).toEqual({ type: 'heads', regions: [{ region, head: 1 }], time: 0 })
    expect(socket.closedWith).toBeUndefined()
  })

  it('signs the device out: revokes the grant and closes', async () => {
    const { socket, connection, revoked, ann, region, hub, clock } = await connectedAsAnn()

    await connection.receive(encode({ type: 'subscribe', region, vv: null }))
    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(revoked).toEqual([ann.tokens])
    expect(socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])

    // Nobody subscribes to the region any more, so it unloads after the idle time.
    expect(hub.loadedRegions()).toBe(1)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)
  })

  it('signs out a device that came with an access token only, with nothing to revoke', async () => {
    const { socket, connection, revoked, ann, logLines } = await connect()

    await connection.receive(
      encode({ type: 'hello', protocol: PROTOCOL_VERSION, access: ann.tokens.access }),
    )
    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(revoked).toEqual([])
    expect(socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 30, identity: ann.identity.id }),
    ])
    expect(logLines.join('\n')).not.toContain(ann.tokens.access)
  })

  it('closes as a failed server, never as signed out, when the grant cannot be revoked twice', async () => {
    const { socket, connection, ann, revoked, logLines } = await connectedAsAnn({
      revoke: () =>
        errAsync(dataError('data:AUTH_FAILED', 'the database refused to revoke the grant')),
    })

    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(revoked).toEqual([ann.tokens, ann.tokens])
    expect(socket.closes).toEqual([[SERVER_ERROR, 'revoke failed']])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 40, code: 'data:AUTH_FAILED' }),
    ])

    const logged = [...logLines, ...socket.closes.map(([, reason]) => reason)].join('\n')

    expect(logged).not.toContain(ann.tokens.access)
    expect(logged).not.toContain(ann.tokens.refresh)
  })

  it('signs the device out when the revoke succeeds on its second try', async () => {
    let tries = 0
    const { socket, connection, ann, revoked } = await connectedAsAnn({
      revoke: () => {
        tries += 1

        return tries === 1
          ? errAsync(dataError('data:AUTH_FAILED', 'the database went away for a moment'))
          : okAsync(undefined)
      },
    })

    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(revoked).toEqual([ann.tokens, ann.tokens])
    expect(socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])
  })

  it('closes a socket that never says hello with the timeout code, not as refused keys', async () => {
    const { socket, clock } = await connect()

    await clock.advance(9_999)
    expect(socket.closedWith).toBeUndefined()

    await clock.advance(1)
    expect(CLOSE.timeout).toBe(4408)
    expect(socket.closedWith?.[0]).toBe(CLOSE.timeout)
  })

  it('logs a renewed pair the socket closed before it could take, without keys', async () => {
    let duringRenewal = () => {}
    const { socket, connection, ann, logLines } = await connect({
      onAuthenticated: () => duringRenewal(),
    })

    duringRenewal = () => connection.closed()
    await connection.receive(
      encode({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        access: 'stale',
        refresh: ann.tokens.refresh,
      }),
    )

    expect(socket.sent).toEqual([])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({
        level: 40,
        identity: ann.identity.id,
        msg: 'renewed pair not delivered',
      }),
    ])
    expect(logLines.join('\n')).not.toContain(ann.tokens.refresh)
  })

  it('closes on a malformed message', async () => {
    const { socket, connection } = await connectedAsAnn()

    await connection.receive('{"type":"push"')

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
  })

  it('closes on a message the protocol refuses, without repeating it', async () => {
    const { socket, connection, region } = await connectedAsAnn()
    const oversized = JSON.stringify({
      type: 'push',
      region,
      batch: 1,
      updates: Array.from({ length: MAX_PUSH_UPDATES + 1 }, () => 'AA=='),
    })

    await connection.receive(oversized)

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
    expect(socket.closedWith?.[1]).not.toContain(region)
    expect(types(socket.sent)).toEqual(['welcome'])
  })

  it('closes when the device says hello twice', async () => {
    const { socket, connection, ann } = await connectedAsAnn()

    await connection.receive(
      encode({ type: 'hello', protocol: PROTOCOL_VERSION, access: ann.tokens.access }),
    )

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
  })

  it('handles each message after the ones before it, a subscribe sent with the hello too', async () => {
    const { socket, connection, ann, region } = await connect()
    const { access, refresh } = ann.tokens

    await Promise.all([
      connection.receive(encode({ type: 'hello', protocol: PROTOCOL_VERSION, access, refresh })),
      connection.receive(encode({ type: 'subscribe', region, vv: null })),
      connection.receive(encode({ type: 'probe', regions: [region] })),
    ])

    expect(types(socket.sent)).toEqual(['welcome', 'updates', 'heads'])
    expect(socket.closedWith).toBeUndefined()
  })

  it('ignores messages once the socket closed and leaves its regions', async () => {
    const { socket, connection, region, hub, clock, connections, ann } = await connectedAsAnn()

    await connection.receive(encode({ type: 'subscribe', region, vv: null }))
    expect(connections.forIdentity(ann.identity.id)).toEqual([connection])
    connection.closed()
    await connection.receive(encode({ type: 'probe', regions: [region] }))

    expect(types(socket.sent)).toEqual(['welcome', 'updates'])
    expect(socket.closedWith).toBeUndefined()
    expect(connections.forIdentity(ann.identity.id)).toEqual([])

    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)
  })

  it('answers a failure it did not expect with an internal error and closes as a failed server', async () => {
    const failure = dataError('data:QUERY_FAILED', 'could not read the heads of regions')
    const { socket, connection } = await connectedAsAnn({
      hub: { heads: () => errAsync(failure) },
    })

    expect(types(socket.sent)).toEqual(['error'])
    expect(socket.sent[0]).toEqual(expect.objectContaining({ type: 'error', code: 'internal' }))
    expect(socket.closes.map(([code]) => code)).toEqual([SERVER_ERROR])
    expect(reported.splice(0)).toEqual([failure])

    await connection.receive(encode({ type: 'probe', regions: [] }))
    expect(socket.sent).toHaveLength(1)
  })

  it("welcomes a member with the private region and every ready organisation's region, and the memberships", async () => {
    const { gateway, anns, acme } = await withAcme(false)
    const { socket, connection } = open(gateway)

    await hello(connection, anns.tokens)

    expect(socket.sent).toEqual([
      {
        type: 'welcome',
        identity: anns.identity.id,
        regions: [
          { region: `identity:${anns.identity.id}`, head: 0 },
          { region: 'tenant:acme', head: 0 },
        ],
        memberships: [acme],
        time: 0,
      },
    ])
  })

  it('closes 4403 a subscribe to the region of an organisation the identity is not a member of', async () => {
    const { gateway, bobs } = await withAcme(false)
    const { socket, connection } = open(gateway)

    await hello(connection, bobs.tokens)
    await connection.receive(encode({ type: 'subscribe', region: 'tenant:acme', vv: null }))

    expect(types(socket.sent)).toEqual(['welcome', 'error'])
    expect(socket.sent[1]).toEqual(
      expect.objectContaining({ type: 'error', code: 'forbidden-region' }),
    )
    expect(socket.closedWith?.[0]).toBe(CLOSE.forbidden)
    expect(gateway.hub.loadedRegions()).toBe(0)
  })

  it('closes 4403 a push into a region the device is not welcomed to', async () => {
    const { gateway, bobs } = await withAcme(false)
    const { socket, connection } = open(gateway)
    const note = (
      await noteCreate(RegionDoc.inMemory('tenant', 'tenant:acme'), {
        id: noteIdFactory.create(),
        author: bobs.identity.id,
        text: 'hello',
      })
    )._unsafeUnwrap()

    await hello(connection, bobs.tokens)
    await connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 1, updates: [note] }),
    )

    expect(types(socket.sent)).toEqual(['welcome', 'error'])
    expect(socket.closedWith?.[0]).toBe(CLOSE.forbidden)
    expect(gateway.hub.loadedRegions()).toBe(0)
  })

  it("checks a member's push against its role: editing another member's note is rejected as forbidden-action, the admin's edit is acknowledged", async () => {
    const { gateway, anns, bobs } = await withAcme(true)
    const annsDevice = open(gateway)
    const bobsDevice = open(gateway)
    const annsDoc = RegionDoc.inMemory('tenant', 'tenant:acme')
    const bobsDoc = RegionDoc.inMemory('tenant', 'tenant:acme')
    const annsId = noteIdFactory.create()
    const bobsId = noteIdFactory.create()

    for (const [device, signedUp] of [
      [annsDevice, anns],
      [bobsDevice, bobs],
    ] as const) {
      await hello(device.connection, signedUp.tokens)
      await device.connection.receive(
        encode({ type: 'subscribe', region: 'tenant:acme', vv: null }),
      )
    }

    const annsNote = (
      await noteCreate(annsDoc, { id: annsId, author: anns.identity.id, text: 'from ann' })
    )._unsafeUnwrap()
    const bobsNote = (
      await noteCreate(bobsDoc, { id: bobsId, author: bobs.identity.id, text: 'from bob' })
    )._unsafeUnwrap()

    await annsDevice.connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 1, updates: [annsNote] }),
    )
    await bobsDevice.connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 1, updates: [bobsNote] }),
    )
    annsDoc.doc.import(bobsNote)
    bobsDoc.doc.import(annsNote)

    const bobsEdit = (await noteUpdate(bobsDoc, { id: annsId, text: 'mine now' }))._unsafeUnwrap()
    const annsEdit = (
      await noteUpdate(annsDoc, { id: bobsId, text: 'edited by ann' })
    )._unsafeUnwrap()

    await bobsDevice.connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 2, updates: [bobsEdit] }),
    )
    await annsDevice.connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 2, updates: [annsEdit] }),
    )

    const answers = (sent: readonly ServerMessage[]) =>
      sent.filter((message) => message.type === 'ack' || message.type === 'reject')

    expect(answers(bobsDevice.socket.sent)).toEqual([
      expect.objectContaining({ type: 'ack', batch: 1 }),
      expect.objectContaining({
        type: 'reject',
        batch: 2,
        reason: 'forbidden-action',
        detail: `note/${annsId}:update`,
      }),
    ])
    expect(answers(annsDevice.socket.sent)).toEqual([
      expect.objectContaining({ type: 'ack', batch: 1 }),
      expect.objectContaining({ type: 'ack', batch: 2 }),
    ])
  })

  it('refuses hello with protocol 1 (4400)', async () => {
    const { socket, connection, ann } = await connect()

    await connection.receive(helloOfProtocol1(ann.tokens))

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
    expect(socket.sent).toEqual([])
  })

  it('closes 4400 a hello with protocol 1', async () => {
    const gateway = await openGateway()
    const signedUp = await gateway.signUp(ann)
    const old = open(gateway)
    const stale = { access: 'stale', refresh: signedUp.tokens.refresh }

    await old.connection.receive(helloOfProtocol1(stale))

    expect(old.socket.closes.map(([code]) => code)).toEqual([CLOSE.protocol])
    expect(old.socket.sent).toEqual([])

    // The keys were never tried: the refresh key is not spent, and renews the pair at a hello of this protocol.
    const current = open(gateway)

    await hello(current.connection, stale)

    expect(types(current.socket.sent)).toEqual(['tokens', 'welcome'])
  })

  it('sends memberships and leaves the region when the identity is removed', async () => {
    const { gateway, anns, bobs } = await withAcme(true)
    const annsDevice = open(gateway)
    const bobsDevice = open(gateway)

    for (const [device, signedUp] of [
      [annsDevice, anns],
      [bobsDevice, bobs],
    ] as const) {
      await hello(device.connection, signedUp.tokens)
      await device.connection.receive(
        encode({ type: 'subscribe', region: 'tenant:acme', vv: null }),
      )
    }

    ;(
      await gateway.organisations.remove({
        actor: anns.identity.id,
        key: 'acme',
        identity: bobs.identity.id,
      })
    )._unsafeUnwrap()
    await bobsDevice.connection.receive(
      encode({ type: 'pull', region: 'tenant:acme', vv: new Uint8Array() }),
    )

    expect(types(bobsDevice.socket.sent)).toEqual(['welcome', 'updates', 'memberships', 'error'])
    expect(bobsDevice.socket.sent[2]).toEqual({ type: 'memberships', memberships: [] })
    expect(bobsDevice.unsubscribed).toEqual(['tenant:acme'])
    expect(bobsDevice.socket.closedWith?.[0]).toBe(CLOSE.forbidden)
    // Ann's memberships did not change: her connection hears nothing and keeps the region.
    expect(types(annsDevice.socket.sent)).toEqual(['welcome', 'updates'])
    expect(annsDevice.unsubscribed).toEqual([])
  })

  it('tells the removed device and leaves the region when the removal fails to delete the member row', async () => {
    let refusing = false
    const { gateway, anns, bobs } = await withAcme(true, {
      tenantQueries: (text) => {
        if (refusing && text === memberRemoveStatement) {
          throw new Error('the database refused the delete')
        }
      },
    })
    const { socket, connection, unsubscribed } = open(gateway)

    await hello(connection, bobs.tokens)
    await connection.receive(encode({ type: 'subscribe', region: 'tenant:acme', vv: null }))
    refusing = true

    const removal = await gateway.organisations.remove({
      actor: anns.identity.id,
      key: 'acme',
      identity: bobs.identity.id,
    })

    expect(removal._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    await connection.receive(encode({ type: 'pull', region: 'tenant:acme', vv: new Uint8Array() }))

    expect(types(socket.sent)).toEqual(['welcome', 'updates', 'memberships', 'error'])
    expect(socket.sent[2]).toEqual({ type: 'memberships', memberships: [] })
    expect(unsubscribed).toEqual(['tenant:acme'])
    expect(socket.closedWith?.[0]).toBe(CLOSE.forbidden)
  })

  it('sends memberships with the new organisation when the identity is invited while connected', async () => {
    const { gateway, anns, bobs, acme } = await withAcme(false)
    const { socket, connection } = open(gateway)

    await hello(connection, bobs.tokens)
    ;(
      await gateway.organisations.invite({ actor: anns.identity.id, key: 'acme', email: bob.email })
    )._unsafeUnwrap()
    // The region is not subscribed on the device's behalf: the device subscribes, and now may.
    await connection.receive(encode({ type: 'subscribe', region: 'tenant:acme', vv: null }))

    expect(types(socket.sent)).toEqual(['welcome', 'memberships', 'updates'])
    expect(socket.sent[1]).toEqual({
      type: 'memberships',
      memberships: [{ tenant: acme.tenant, role: 'member' }],
    })
    expect(socket.closedWith).toBeUndefined()
  })

  it('a removal takes effect while the connection is busy with another message', async () => {
    const { gateway, anns, bobs } = await withAcme(true)
    const heads = holding()
    const annsDevice = open(gateway)
    const bobsDevice = openHolding(gateway, heads)

    for (const [device, signedUp] of [
      [annsDevice, anns],
      [bobsDevice, bobs],
    ] as const) {
      await hello(device.connection, signedUp.tokens)
      await device.connection.receive(
        encode({ type: 'subscribe', region: 'tenant:acme', vv: null }),
      )
    }

    const bobsNote = await acmeNote(bobs.identity.id, 'from bob')
    const annsNote = await acmeNote(anns.identity.id, 'from ann')
    const reached = heads.hold()
    // Bob's device probes its private region; a push into Acme's waits behind the probe.
    const probing = bobsDevice.connection.receive(
      encode({ type: 'probe', regions: [`identity:${bobs.identity.id}`] }),
    )
    const pushing = bobsDevice.connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 1, updates: [bobsNote] }),
    )

    await reached
    ;(
      await gateway.organisations.remove({
        actor: anns.identity.id,
        key: 'acme',
        identity: bobs.identity.id,
      })
    )._unsafeUnwrap()
    // A note Ann pushes once the removal answered does not reach Bob's device.
    await annsDevice.connection.receive(
      encode({ type: 'push', region: 'tenant:acme', batch: 1, updates: [annsNote] }),
    )
    heads.release()
    await probing
    await pushing

    expect(types(bobsDevice.socket.sent)).toEqual([
      'welcome',
      'updates',
      'memberships',
      'heads',
      'error',
    ])
    expect(bobsDevice.socket.sent[4]).toEqual(
      expect.objectContaining({ type: 'error', code: 'forbidden-region' }),
    )
    expect(bobsDevice.socket.closedWith?.[0]).toBe(CLOSE.forbidden)
    expect(bobsDevice.unsubscribed).toEqual(['tenant:acme'])
    expect(types(annsDevice.socket.sent)).toEqual(['welcome', 'updates', 'ack'])
    // Bob's push queued before the removal took effect never reached the region.
    expect((await gateway.hub.heads(['tenant:acme']))._unsafeUnwrap()).toEqual([
      { region: 'tenant:acme', head: 1 },
    ])
  })

  it('memberships(next) resolves after the message was sent, while the connection is busy with another message', async () => {
    const { gateway, bobs } = await withAcme(true)
    const heads = holding()
    const { socket, connection, unsubscribed } = openHolding(gateway, heads)

    await hello(connection, bobs.tokens)
    await connection.receive(encode({ type: 'subscribe', region: 'tenant:acme', vv: null }))

    const reached = heads.hold()
    const probing = connection.receive(
      encode({ type: 'probe', regions: [`identity:${bobs.identity.id}`] }),
    )

    await reached
    await connection.memberships([])

    expect(types(socket.sent)).toEqual(['welcome', 'updates', 'memberships'])
    expect(socket.sent[2]).toEqual({ type: 'memberships', memberships: [] })
    expect(unsubscribed).toEqual(['tenant:acme'])

    heads.release()
    await probing

    expect(types(socket.sent)).toEqual(['welcome', 'updates', 'memberships', 'heads'])
    expect(socket.closedWith).toBeUndefined()
  })

  it('a removal whose memberships reread fails still takes the region from the live connection', async () => {
    let removed = false
    const { gateway, anns, bobs } = await withAcme(true, {
      // The directory goes away for a moment once the membership is deleted.
      directoryQueries: (text) => {
        if (text === membershipRemoveStatement) {
          removed = true
        } else if (removed && text === membershipsOfStatement) {
          throw new Error('the directory went away for a moment')
        }
      },
    })
    const annsDevice = open(gateway)
    const bobsDevice = open(gateway)

    for (const [device, signedUp] of [
      [annsDevice, anns],
      [bobsDevice, bobs],
    ] as const) {
      await hello(device.connection, signedUp.tokens)
      await device.connection.receive(
        encode({ type: 'subscribe', region: 'tenant:acme', vv: null }),
      )
    }

    const removal = await gateway.organisations.remove({
      actor: anns.identity.id,
      key: 'acme',
      identity: bobs.identity.id,
    })

    expect(removal._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    removed = false

    await annsDevice.connection.receive(
      encode({
        type: 'push',
        region: 'tenant:acme',
        batch: 1,
        updates: [await acmeNote(anns.identity.id, 'from ann')],
      }),
    )
    await bobsDevice.connection.receive(
      encode({ type: 'pull', region: 'tenant:acme', vv: new Uint8Array() }),
    )

    // Not told (the memberships could not be read), yet out of the region: no note of Ann's,
    // and a pull is refused.
    expect(types(bobsDevice.socket.sent)).toEqual(['welcome', 'updates', 'error'])
    expect(bobsDevice.socket.closedWith?.[0]).toBe(CLOSE.forbidden)
    expect(bobsDevice.unsubscribed).toEqual(['tenant:acme'])
    expect(types(annsDevice.socket.sent)).toEqual(['welcome', 'updates', 'ack'])
  })

  it('a change of memberships told during the hello applies right after the welcome', async () => {
    const { gateway, bobs } = await withAcme(true)
    const heads = holding()
    const { socket, connection } = openHolding(gateway, heads)
    const reached = heads.hold()
    const helloed = hello(connection, bobs.tokens)

    // The hello read the memberships, Acme among them, and waits for the heads.
    await reached
    await gateway.connections.revoke(bobs.identity.id, 'tenant:acme')

    let sentWhenTold: string[] | undefined
    const told = gateway.connections.tell(bobs.identity.id, []).then(() => {
      sentWhenTold = types(socket.sent)
    })

    heads.release()
    await helloed
    await told

    expect(sentWhenTold).toEqual(['welcome', 'memberships'])

    await connection.receive(encode({ type: 'subscribe', region: 'tenant:acme', vv: null }))

    expect(types(socket.sent)).toEqual(['welcome', 'memberships', 'error'])
    expect(socket.closedWith?.[0]).toBe(CLOSE.forbidden)
  })
})

describe('regionsFor', () => {
  const identity = identityIdFactory.create()
  const other = identityIdFactory.create()
  const membership = (key: string): Membership => ({
    tenant: { id: tenantIdFactory.create(), key, name: key },
    role: 'member',
  })

  it("makes the identity the owner of its private region and judges its organisation's region by its role", () => {
    const regions = regionsFor(identity, [membership('acme')], replicaSchema)
    const acme = regions.get('tenant:acme')?.actor.ability

    expect(regions.get(`identity:${identity}`)?.actor).toEqual({
      id: identity,
      ability: OWNER_ABILITY,
    })
    expect(acme?.can('update', 'note', { author: `member:${identity}` })).toBe(true)
    expect(acme?.can('update', 'note', { author: `member:${other}` })).toBe(false)
  })

  it('allows nothing in a tenant region whose membership names no organisation key', () => {
    const regions = regionsFor(identity, [membership('Not A Key')], replicaSchema)

    expect(regions.get('tenant:Not A Key')?.actor.ability).toBe(NO_ABILITY)
  })
})
