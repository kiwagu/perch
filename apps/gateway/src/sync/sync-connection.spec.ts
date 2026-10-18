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

import { DeviceSessions } from '../auth/device-sessions'
import {
  type AuthenticatedDevice,
  type DeviceTokens,
  grantIdOf,
  IdentitySessions,
} from '../auth/identity-sessions'
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

/** The device every test signs in on and says hello from, unless it names another. */
const DEVICE = 'device-laptop'

/** Five minutes: a device is marked seen at most this often. */
const SEEN_EVERY_MS = 5 * 60_000

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

/** Waits for the next whole second, in which a sign-in starts a session later than any token so far. */
function nextSecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1_010 - (Date.now() % 1_000)))
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
  /** Answers the revoke of a grant; it goes to the directory by default. */
  readonly revokeGrant?: SyncConnectionDeps['devices']['revokeGrant']
  /** Answers the mark of a signed-out device; it goes to the directory by default. */
  readonly signedOut?: SyncConnectionDeps['devices']['signedOut']
  /** Runs once keys were accepted, before the connection hears the outcome. */
  readonly onAuthenticated?: (device: AuthenticatedDevice) => void
  /** Holds each check of the keys until it resolves, as a slow database would. */
  readonly authenticating?: () => Promise<void>
  /** Holds each read of the device's row until it resolves. */
  readonly binding?: () => Promise<void>
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
 * wires it. `outage` makes the auth sessions opened from then on fail to open, as a database that
 * cannot be reached would, after the first `after` of them; what it answers ends the outage.
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

  const devices = new DeviceSessions({ directory: local, clock })

  const sessions = new IdentitySessions({
    openAuth: () =>
      createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
    onFailure: (error) => reported.push(error),
    devices,
    clock,
  })
  const newSession = local.db.newSession.bind(local.db)
  const outage = (after = 0): (() => void) => {
    let opened = 0

    local.db.newSession = () => {
      opened += 1

      return opened > after
        ? Promise.reject(new Error('the database cannot be reached'))
        : newSession()
    }

    return () => {
      local.db.newSession = newSession
    }
  }
  const connections = new ConnectionRegistry({ onFailure: (error) => reported.push(error) })
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
    devices,
    organisations,
    connections,
    outage,
    signUp: async (credentials: typeof ann) =>
      (await sessions.signUp(credentials, { id: DEVICE, label: 'Laptop' }))._unsafeUnwrap(),
    /** Signs the identity of `credentials` in on another device. */
    signIn: async (credentials: typeof ann, device: string) =>
      (await sessions.signIn(credentials, { id: device, label: device }))._unsafeUnwrap(),
  }
}

type Gateway = Awaited<ReturnType<typeof openGateway>>

/** A connection of a device to the gateway over a fake socket; it has not said hello yet. */
function open(gateway: Gateway, options: ConnectOptions = {}) {
  const { hub, sessions, devices } = gateway
  /** The grants the connection revoked, in order. */
  const revokedGrants: Array<{ readonly identity: string; readonly grant: string }> = []
  /** The devices the connection marked seen, in order. */
  const seen: Array<{ readonly identity: string; readonly device: string }> = []
  const logLines: string[] = []
  /** The regions the connection left at the hub, in order. */
  const unsubscribed: string[] = []
  const socket = new FakeSocket()
  const connection = new SyncConnection(socket, {
    sessions: {
      authenticate: (tokens) =>
        ResultAsync.fromSafePromise(options.authenticating?.() ?? Promise.resolve())
          .andThen(() => sessions.authenticate(tokens))
          .andTee((authenticated) => options.onAuthenticated?.(authenticated)),
      park: (parking) => sessions.park(parking),
      parked: (presented) => sessions.parked(presented),
      unpark: (identity, device) => sessions.unpark(identity, device),
    },
    devices: {
      seen: (device) => {
        seen.push(device)

        return okAsync(undefined)
      },
      bind: (device) =>
        ResultAsync.fromSafePromise(options.binding?.() ?? Promise.resolve()).andThen(() =>
          devices.bind(device),
        ),
      rotate: (rotation) => devices.rotate(rotation),
      revokeGrant: (grant) => {
        revokedGrants.push(grant)

        return options.revokeGrant ? options.revokeGrant(grant) : devices.revokeGrant(grant)
      },
      signedOut: (pair) => (options.signedOut ? options.signedOut(pair) : devices.signedOut(pair)),
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

  return { socket, connection, revokedGrants, seen, logLines, unsubscribed }
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

/** Says hello from `device` with a pair the gateway gave at sign-up or sign-in. */
function hello(
  connection: SyncConnection,
  { access, refresh }: DeviceTokens,
  device: string = DEVICE,
): Promise<void> {
  return connection.receive(
    encode({ type: 'hello', protocol: PROTOCOL_VERSION, access, refresh, device }),
  )
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
      encode({ type: 'hello', protocol: PROTOCOL_VERSION, access: 'garbage', device: DEVICE }),
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
        device: DEVICE,
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

  it('signs the device out through the database: its row marked, its grant revoked, its parked pairs forgotten', async () => {
    const { socket, connection, revokedGrants, ann, region, hub, clock, devices, sessions } =
      await connectedAsAnn()
    const spent = 'surreal-refresh-spent-secret'

    sessions.park({
      identity: ann.identity.id,
      device: DEVICE,
      spentRefresh: spent,
      tokens: { access: 'parked-access', refresh: 'surreal-refresh-parked-secret' },
    })
    await connection.receive(encode({ type: 'subscribe', region, vv: null }))
    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(revokedGrants).toEqual([
      { identity: ann.identity.id, grant: grantIdOf(ann.tokens.refresh) },
    ])
    expect(socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])
    // The device's row is marked: it is listed as signed out.
    expect((await devices.list(ann.identity.id))._unsafeUnwrap()[0]?.revokedAt).toBeInstanceOf(Date)
    // The grant is revoked in the database: its refresh key renews nothing.
    expect(
      (
        await sessions.authenticate({ access: 'stale', refresh: ann.tokens.refresh })
      )._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
    expect(sessions.parked({ device: DEVICE, refresh: spent })).toBeUndefined()

    // Nobody subscribes to the region any more, so it unloads after the idle time.
    expect(hub.loadedRegions()).toBe(1)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)
  })

  it('signs out a device that came with an access token only, with nothing to revoke', async () => {
    const { socket, connection, revokedGrants, ann, logLines } = await connect()

    await connection.receive(
      encode({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        access: ann.tokens.access,
        device: DEVICE,
      }),
    )
    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(revokedGrants).toEqual([])
    expect(socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 30, identity: ann.identity.id }),
    ])
    expect(logLines.join('\n')).not.toContain(ann.tokens.access)
  })

  it('closes as a failed server, never as signed out, when the grant cannot be revoked', async () => {
    const { socket, connection, ann, devices, logLines } = await connectedAsAnn({
      revokeGrant: () => errAsync(dataError('data:WRITE_FAILED', 'the directory went away')),
    })

    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(socket.closes).toEqual([[SERVER_ERROR, 'revoke failed']])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 40, code: 'data:WRITE_FAILED' }),
    ])
    // The row was marked before: a sign-out the device sends again completes it.
    expect((await devices.list(ann.identity.id))._unsafeUnwrap()[0]?.revokedAt).toBeInstanceOf(Date)

    const logged = [...logLines, ...socket.closes.map(([, reason]) => reason)].join('\n')

    expect(logged).not.toContain(ann.tokens.access)
    expect(logged).not.toContain(ann.tokens.refresh)
    expect(logged).not.toContain(String(grantIdOf(ann.tokens.refresh)))
  })

  it('closes as a failed server, revoking nothing, when the row cannot be marked', async () => {
    const { socket, connection, revokedGrants, ann, sessions, logLines } = await connectedAsAnn({
      signedOut: () => errAsync(dataError('data:WRITE_FAILED', 'the directory went away')),
    })

    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(socket.closes).toEqual([[SERVER_ERROR, 'revoke failed']])
    expect(revokedGrants).toEqual([])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 40, code: 'data:WRITE_FAILED' }),
    ])
    expect(
      (await sessions.authenticate({ access: 'stale', refresh: ann.tokens.refresh })).isOk(),
    ).toBe(true)
  })

  it('closes a socket that never says hello with the timeout code, not as refused keys', async () => {
    const { socket, clock } = await connect()

    await clock.advance(9_999)
    expect(socket.closedWith).toBeUndefined()

    await clock.advance(1)
    expect(CLOSE.timeout).toBe(4408)
    expect(socket.closedWith?.[0]).toBe(CLOSE.timeout)
  })

  it('parks a renewed pair the socket closed before it could take, and logs it without keys', async () => {
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
        device: DEVICE,
      }),
    )

    expect(socket.sent).toEqual([])
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({
        level: 40,
        identity: ann.identity.id,
        msg: 'renewed pair not delivered: parked for the next hello of the device',
      }),
    ])
    expect(logLines.join('\n')).not.toContain(ann.tokens.refresh)
  })

  it('hands the parked pair to the next hello of the device with the spent refresh key, then welcomes it', async () => {
    let renewed: AuthenticatedDevice | undefined
    let duringRenewal = (_: AuthenticatedDevice) => {}
    const fixture = await connect({ onAuthenticated: (device) => duringRenewal(device) })
    const stale = { access: 'stale', refresh: fixture.ann.tokens.refresh }

    // The first socket closes while its hello renews the pair: the device never sees it.
    duringRenewal = (device) => {
      renewed = device
      fixture.connection.closed()
    }
    await hello(fixture.connection, stale)

    const pair = renewed?.renewed ? renewed.tokens : expect.unreachable('a renewed pair')
    const retry = open(fixture)

    await hello(retry.connection, stale)

    expect(fixture.socket.sent).toEqual([])
    expect(retry.socket.sent).toEqual([
      { type: 'tokens', access: pair.access, refresh: pair.refresh },
      {
        type: 'welcome',
        identity: fixture.ann.identity.id,
        regions: [{ region: fixture.region, head: 0 }],
        memberships: [],
        time: 0,
      },
    ])
    expect(retry.socket.closedWith).toBeUndefined()

    // The pair is handed once: a third hello with the spent key is refused.
    const third = open(fixture)

    await hello(third.connection, stale)

    expect(third.socket.closes.map(([code]) => code)).toEqual([CLOSE.unauthorized])
  })

  it('parks the pair again when the retry closes before it could take it', async () => {
    let closeRetry = () => {}
    let duringRenewal = () => {}
    const fixture = await connect({ onAuthenticated: () => duringRenewal() })
    const stale = { access: 'stale', refresh: fixture.ann.tokens.refresh }

    duringRenewal = () => fixture.connection.closed()
    await hello(fixture.connection, stale)

    const retry = open(fixture, { onAuthenticated: () => closeRetry() })

    closeRetry = () => retry.connection.closed()
    await hello(retry.connection, stale)

    const last = open(fixture)

    await hello(last.connection, stale)

    expect(retry.socket.sent).toEqual([])
    expect(types(last.socket.sent)).toEqual(['tokens', 'welcome'])
  })

  it("refuses the spent refresh key from another device: a parked pair is its own device's only", async () => {
    let duringRenewal = () => {}
    const fixture = await connect({ onAuthenticated: () => duringRenewal() })
    const stale = { access: 'stale', refresh: fixture.ann.tokens.refresh }

    duringRenewal = () => fixture.connection.closed()
    await hello(fixture.connection, stale)

    const other = open(fixture)

    await hello(other.connection, stale, 'device-phone')

    expect(other.socket.closes.map(([code]) => code)).toEqual([CLOSE.unauthorized])
    expect(other.socket.sent).toEqual([])
  })

  it('closes as a failed server a hello whose keys the database could not judge, and takes them once it answers', async () => {
    const fixture = await connect()
    const stale = { access: 'stale', refresh: fixture.ann.tokens.refresh }
    const end = fixture.outage()

    await hello(fixture.connection, stale)

    expect(fixture.socket.closes.map(([code]) => code)).toEqual([SERVER_ERROR])
    expect(types(fixture.socket.sent)).toEqual(['error'])
    expect(reported.splice(0).map((error) => error.code)).toEqual(['data:QUERY_FAILED'])

    end()

    const retry = open(fixture)

    await hello(retry.connection, stale)

    expect(types(retry.socket.sent)).toEqual(['tokens', 'welcome'])
  })

  it('keeps the parked pair when the keys of a hello could not be judged', async () => {
    let duringRenewal = () => {}
    const fixture = await connect({ onAuthenticated: () => duringRenewal() })
    const stale = { access: 'stale', refresh: fixture.ann.tokens.refresh }

    duringRenewal = () => fixture.connection.closed()
    await hello(fixture.connection, stale)

    const end = fixture.outage()
    const during = open(fixture)

    await hello(during.connection, stale)

    expect(during.socket.closes.map(([code]) => code)).toEqual([SERVER_ERROR])
    expect(reported.splice(0).map((error) => error.code)).toEqual(['data:QUERY_FAILED'])

    end()

    const after = open(fixture)

    await hello(after.connection, stale)

    expect(types(after.socket.sent)).toEqual(['tokens', 'welcome'])
  })

  it('parks the pair again when the database could not judge it at the hello it was handed to', async () => {
    let duringRenewal = () => {}
    const fixture = await connect({ onAuthenticated: () => duringRenewal() })
    const stale = { access: 'stale', refresh: fixture.ann.tokens.refresh }

    duringRenewal = () => fixture.connection.closed()
    await hello(fixture.connection, stale)

    // The spent key is refused; the check of the parked pair cannot open its session.
    const end = fixture.outage(1)
    const during = open(fixture)

    await hello(during.connection, stale)

    expect(during.socket.closes.map(([code]) => code)).toEqual([SERVER_ERROR])
    expect(reported.splice(0).map((error) => error.code)).toEqual(['data:QUERY_FAILED'])

    end()

    const after = open(fixture)

    await hello(after.connection, stale)

    expect(types(after.socket.sent)).toEqual(['tokens', 'welcome'])
  })

  it('closes 4400 a hello that names no device, without trying its keys', async () => {
    let tried = false
    const { socket, connection, ann } = await connect({
      onAuthenticated: () => {
        tried = true
      },
    })

    // The protocol's encoder cannot write a hello without its device.
    await connection.receive(
      JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, access: ann.tokens.access }),
    )

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
    expect(socket.sent).toEqual([])
    expect(tried).toBe(false)
  })

  it('marks the device seen at its hello, then at most every five minutes', async () => {
    const { connection, seen, clock, region, ann } = await connectedAsAnn()
    const probe = () => connection.receive(encode({ type: 'probe', regions: [region] }))

    expect(seen).toEqual([{ identity: ann.identity.id, device: DEVICE }])

    await clock.advance(SEEN_EVERY_MS - 1)
    await probe()

    expect(seen).toHaveLength(1)

    await clock.advance(1)
    await probe()
    await probe()

    expect(seen).toEqual([
      { identity: ann.identity.id, device: DEVICE },
      { identity: ann.identity.id, device: DEVICE },
    ])
  })

  it('closes at once with 4001 when the device is signed out from another one, whatever it is doing', async () => {
    const gateway = await openGateway()
    const signedUp = await gateway.signUp(ann)
    const heads = holding()
    const { socket, connection } = openHolding(gateway, heads)
    const region = `identity:${signedUp.identity.id}`

    await hello(connection, signedUp.tokens)

    const reached = heads.hold()
    const probing = connection.receive(encode({ type: 'probe', regions: [region] }))

    await reached
    await gateway.connections.close(signedUp.identity.id, DEVICE, CLOSE.revoked)

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(gateway.connections.forIdentity(signedUp.identity.id)).toEqual([])

    heads.release()
    await probing

    expect(types(socket.sent)).toEqual(['welcome'])
  })

  it('closes with 4001 a device signed out while its hello is under way, before its welcome', async () => {
    const gateway = await openGateway()
    const signedUp = await gateway.signUp(ann)
    const heads = holding()
    const { socket, connection } = openHolding(gateway, heads)
    const reached = heads.hold()
    const helloed = hello(connection, signedUp.tokens)

    await reached
    await gateway.connections.close(signedUp.identity.id, undefined, CLOSE.revoked)

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])

    heads.release()
    await helloed

    expect(socket.sent).toEqual([])
  })

  it('closes 4401 a hello under a device that has no session, and registers nothing', async () => {
    const { socket, connection, ann, connections, seen } = await connect()

    await hello(connection, ann.tokens, 'device-unlisted')

    expect(socket.closes).toEqual([[CLOSE.unauthorized, 'no session for this device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    expect(seen).toEqual([])
  })

  it('closes 4001 a hello with a working access token for a device signed out from another one', async () => {
    const { socket, connection, ann, connections, devices } = await connect()
    const [row] = (await devices.list(ann.identity.id))._unsafeUnwrap()

    ;(
      await devices.revoke({
        identity: ann.identity.id,
        id: row?.id ?? expect.unreachable("Ann's laptop listed"),
      })
    )._unsafeUnwrap()
    await hello(connection, { access: ann.tokens.access, refresh: ann.tokens.refresh })

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
  })

  it('closes 4401 a hello with an access token issued before its device signed in again, and welcomes the new pair', async () => {
    const fixture = await connect()
    const { socket, connection, ann, connections, devices } = fixture
    const [row] = (await devices.list(ann.identity.id))._unsafeUnwrap()

    ;(
      await devices.revoke({
        identity: ann.identity.id,
        id: row?.id ?? expect.unreachable("Ann's laptop listed"),
      })
    )._unsafeUnwrap()

    // Signed in again on the laptop in a later second: its row is live again, with a new session.
    await nextSecond()

    const again = await fixture.signIn(
      { email: ann.identity.email, password: 'pass-word-1' },
      DEVICE,
    )

    await hello(connection, ann.tokens)

    expect(socket.closes).toEqual([[CLOSE.unauthorized, 'no session for this device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])

    const fresh = open(fixture)

    await hello(fresh.connection, again.tokens)

    expect(types(fresh.socket.sent)).toEqual(['welcome'])
  })

  it("closes 4401 a renewal under another device's id: that device keeps its grant, the new one is revoked", async () => {
    let renewed: AuthenticatedDevice | undefined
    const fixture = await connect({
      onAuthenticated: (device) => {
        renewed = device
      },
    })
    const { socket, connection, ann, devices, sessions } = fixture
    const phone = await fixture.signIn(
      { email: ann.identity.email, password: 'pass-word-1' },
      'device-phone',
    )
    const phoneRow = () =>
      devices.list(ann.identity.id).map((rows) => rows.find((row) => row.device === 'device-phone'))
    const before = (await phoneRow())._unsafeUnwrap()

    await hello(connection, { access: 'stale', refresh: ann.tokens.refresh }, 'device-phone')

    const pair = renewed?.renewed ? renewed.tokens : expect.unreachable('a renewed pair')

    expect(socket.closes).toEqual([[CLOSE.unauthorized, 'no session for this device']])
    expect(socket.sent).toEqual([])
    expect((await phoneRow())._unsafeUnwrap()?.grant).toBe(before?.grant)
    expect(phone.tokens.refresh).not.toBe(pair.refresh)
    expect((await sessions.authenticate({ access: 'stale', refresh: pair.refresh })).isErr()).toBe(
      true,
    )
  })

  it('leaves a signed-out device revoked when its pair is renewed at hello, and revokes the new grant', async () => {
    let renewed: AuthenticatedDevice | undefined
    const { socket, connection, ann, devices, sessions } = await connect({
      onAuthenticated: (device) => {
        renewed = device
      },
    })

    // The row is marked, the grant left: a refresh still renews.
    ;(
      await devices.signedOut({
        identity: ann.identity.id,
        grant: grantIdOf(ann.tokens.refresh) ?? 'none',
      })
    )._unsafeUnwrap()
    await hello(connection, { access: 'stale', refresh: ann.tokens.refresh })

    const pair = renewed?.renewed ? renewed.tokens : expect.unreachable('a renewed pair')
    const [row] = (await devices.list(ann.identity.id))._unsafeUnwrap()

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(row?.revokedAt).toBeInstanceOf(Date)
    expect(row?.grant).toBe(grantIdOf(ann.tokens.refresh))
    expect((await sessions.authenticate({ access: 'stale', refresh: pair.refresh })).isErr()).toBe(
      true,
    )
  })

  it('closes 4001 a hello whose device is signed out while its keys are checked', async () => {
    let release = () => {}
    const checking = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = await connect({ authenticating: () => checking })
    const { socket, connection, ann, connections, devices } = fixture
    const [row] = (await devices.list(ann.identity.id))._unsafeUnwrap()
    const helloed = hello(connection, ann.tokens)

    // As the route does: the row first, then the sockets.
    ;(
      await devices.revoke({
        identity: ann.identity.id,
        id: row?.id ?? expect.unreachable("Ann's laptop listed"),
      })
    )._unsafeUnwrap()
    await connections.close(ann.identity.id, DEVICE, CLOSE.revoked)
    release()
    await helloed

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
  })

  it('closes 4001 a hello whose device is closed while its row is read, and registers nothing', async () => {
    let release = () => {}
    let reached = () => {}
    const reading = new Promise<void>((resolve) => {
      reached = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = await connect({
      binding: () => {
        reached()

        return held
      },
    })
    const { socket, connection, ann, connections } = fixture
    const helloed = hello(connection, ann.tokens)

    await reading
    await connections.close(ann.identity.id, undefined, CLOSE.revoked)
    release()
    await helloed

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
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
      encode({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        access: ann.tokens.access,
        device: DEVICE,
      }),
    )

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
  })

  it('handles each message after the ones before it, a subscribe sent with the hello too', async () => {
    const { socket, connection, ann, region } = await connect()
    const { access, refresh } = ann.tokens

    await Promise.all([
      connection.receive(
        encode({ type: 'hello', protocol: PROTOCOL_VERSION, access, refresh, device: DEVICE }),
      ),
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
