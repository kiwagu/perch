import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { type DataError, dataError, openLocalDb, tenantDatabase } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { idSchemas, noteIdFactory, profileIdFactory } from '@workspace/ids'
import { createLogger } from '@workspace/logger'
import { RegionDoc } from '@workspace/replica'
import {
  CLOSE,
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  MAX_PUSH_UPDATES,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'
import { RegionHub } from '@workspace/replica/server'
import { manualClock } from '@workspace/replica/testing'

import {
  AUTH_SECRET,
  deviceHeaders,
  openAuth,
  signUpOn,
} from '../../auth/__fixtures__/auth-instance'
import { authHandler } from '../../auth/auth-handler'
import { AuthSessions, type SessionRead } from '../../auth/auth-sessions'
import { NAMESPACE } from '../../config'
import { KeyedTurns } from '../../keyed-turns'
import { RequestLimits } from '../../limits/request-limits'
import { Organisations } from '../../tenants/organisations'
import { regionDatabases } from '../../tenants/region-databases'
import memberRemoveStatement from '../../tenants/surql/member-remove.surql'
import membershipRemoveStatement from '../../tenants/surql/membership-remove.surql'
import membershipsOfStatement from '../../tenants/surql/memberships-of.surql'
import { TenantDatabases } from '../../tenants/tenant-databases'
import { noteCreate, noteUpdate } from '../__fixtures__/note'
import { profileCreate } from '../__fixtures__/profile'
import { ConnectionRegistry } from '../connections'

import { SyncConnection } from './connection'
import type { SocketLike, SyncConnectionDeps } from './deps'

const ann = { email: 'ann@example.test' }

const bob = { email: 'bob@example.test' }

/** The device every test signs up on and says hello from, unless it names another. */
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

  send(text: string): number {
    this.sent.push(decodeMessage(serverMessage, text)._unsafeUnwrap())

    return text.length
  }

  close(code: number, reason: string): void {
    this.closes.push([code, reason])
  }
}

/** Closes what each test opened: the hub, then the organisations' databases, then the directory. */
const cleanups: Array<() => Promise<void>> = []

/** Failures the hub or the connection reported; a test that expects one takes it. */
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

/** A hello of an earlier protocol, which the encoder of this one cannot write: keys, no token. */
function helloOfProtocol(protocol: number, access: string): string {
  return JSON.stringify({ type: 'hello', protocol, access, device: DEVICE })
}

function types(messages: readonly ServerMessage[]): string[] {
  return messages.map((message) => message.type)
}

interface ConnectOptions {
  /** Replaces hub calls, to make them fail. */
  readonly hub?: Partial<SyncConnectionDeps['hub']>
  /**
   * Reads the session of a hello in place of the gateway, given the read the gateway makes: to
   * hold it, or to answer another outcome.
   */
  readonly read?: (
    token: string,
    read: (token: string) => Promise<SessionRead>,
  ) => Promise<SessionRead>
  /** Ends the session of a device that signs out over its channel; the directory ends it by default. */
  readonly signOut?: SyncConnectionDeps['sessions']['signOut']
}

interface GatewayOptions {
  /** Runs before each query sent to an organisation's database; it may throw to make the query fail. */
  readonly tenantQueries?: (text: string) => void
  /** Runs before each query the organisations send to the directory; it may throw to make the query fail. */
  readonly directoryQueries?: (text: string) => void
}

/**
 * The gateway's services on a fresh embedded directory, each organisation's database on an
 * embedded engine of its own: Better Auth and the sessions it reads, organisations, a real hub
 * over both, and the registry of connections, which hears every change of memberships as the
 * composition root wires it.
 */
async function openGateway(options: GatewayOptions = {}) {
  const opened = await openAuth()
  const { local } = opened
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
    await opened.close()
  })

  // Sessions end on the clock of Better Auth's hooks, which lies behind the system clock.
  const sessions = new AuthSessions({
    auth: opened.auth,
    directory: local,
    clock: opened.clock,
    secret: AUTH_SECRET,
  })
  const connections = new ConnectionRegistry({ onFailure: (error) => reported.push(error) })
  const organisations = new Organisations({
    directory: options.directoryQueries ? interceptQueries(local, options.directoryQueries) : local,
    databases,
    revoke: (identity, region) => connections.revoke(identity, region),
  })

  organisations.onChange((identity, memberships) => connections.tell(identity, memberships))

  /** The gateway's mount of Better Auth's sign-in, over the same registry. */
  const authRoute = authHandler({
    auth: opened.auth,
    sessions,
    limits: new RequestLimits({ clock: opened.clock }),
    connections,
    clock: opened.clock,
    accounts: new KeyedTurns<string>(),
  })

  return {
    clock,
    hub,
    sessions,
    organisations,
    connections,
    /** Signs `email` in again on `device` through the gateway's mount: the status it answers. */
    signInAgain: async ({ email }: { readonly email: string }, device: string = DEVICE) => {
      const headers = deviceHeaders(device)

      headers.set('content-type', 'application/json')

      const response = await authRoute(
        new Request('http://127.0.0.1:4000/auth/sign-in/email', {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, password: 'Pass-word-1' }),
        }),
        '203.0.113.7',
      )

      return response?.status
    },
    /**
     * Signs `email` up and verifies it on `device`: the identity, and the raw token of the session
     * the verification signed in.
     */
    signUp: async ({ email }: { readonly email: string }, device: string = DEVICE) => {
      const { token, user } = await signUpOn(opened.auth, email, deviceHeaders(device))

      return {
        identity: { id: idSchemas.identity.schema.parse(user.id), email: user.email },
        token,
      }
    },
  }
}

type Gateway = Awaited<ReturnType<typeof openGateway>>

/** A connection of a device to the gateway over a fake socket; it has not said hello yet. */
function open(gateway: Gateway, options: ConnectOptions = {}) {
  const { hub, sessions } = gateway
  /** The token of each session the connection read, in order. */
  const reads: string[] = []
  /** The devices the connection marked seen, in order. */
  const seen: Array<{ readonly identity: string; readonly device: string }> = []
  const logLines: string[] = []
  /** The regions the connection left at the hub, in order. */
  const unsubscribed: string[] = []
  const socket = new FakeSocket()
  const read = (token: string) => sessions.read(token)
  const connection = new SyncConnection(socket, {
    sessions: {
      read: (token) => {
        reads.push(token)

        return options.read ? options.read(token, read) : read(token)
      },
      signOut: (token) => (options.signOut ? options.signOut(token) : sessions.signOut(token)),
    },
    devices: {
      seen: (device) => {
        seen.push(device)

        return okAsync(undefined)
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

  return { socket, connection, reads, seen, logLines, unsubscribed }
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

/**
 * A read of sessions held once it is made, before it answers; `reached` resolves once a read
 * waits, `release` lets it answer.
 */
function heldRead() {
  let reached = () => {}
  let release = () => {}
  const waiting = new Promise<void>((resolve) => {
    reached = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  return {
    reached: waiting,
    release: () => release(),
    read: async (token: string, read: (token: string) => Promise<SessionRead>) => {
      const answer = await read(token)

      reached()
      await held

      return answer
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

/** Says hello from `device` with the session token a sign-up gave. */
function hello(connection: SyncConnection, token: string, device: string = DEVICE): Promise<void> {
  return connection.receive(encode({ type: 'hello', protocol: PROTOCOL_VERSION, token, device }))
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

type Connected = Awaited<ReturnType<typeof connect>>

/** A connection where Ann said hello with the session token her sign-up gave her. */
async function connectedAsAnn(options: ConnectOptions = {}) {
  const fixture = await connect(options)

  await hello(fixture.connection, fixture.ann.token)

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

  it('welcomes a device whose token reads its session: registered, marked seen, sent its region', async () => {
    const { socket, connection, ann, clock, connections, seen } = await connect()

    await clock.advance(1_000)
    await hello(connection, ann.token)

    expect(socket.sent).toEqual([
      {
        type: 'welcome',
        identity: ann.identity.id,
        regions: [{ region: `identity:${ann.identity.id}`, head: 0 }],
        memberships: [],
        time: 1_000,
      },
    ])
    expect(socket.closedWith).toBeUndefined()
    expect(connections.forIdentity(ann.identity.id)).toEqual([connection])
    expect(seen).toEqual([{ identity: ann.identity.id, device: DEVICE }])
    // The hello timer is gone with the hello.
    expect(clock.pending()).toBe(0)
  })

  it.each<{ readonly name: string; readonly token: (fixture: Connected) => Promise<string> }>([
    { name: 'a token nobody holds', token: async () => 'garbage' },
    {
      name: 'the token of a session that ended',
      token: async ({ sessions, ann }) => {
        ;(await sessions.signOut(ann.token))._unsafeUnwrap()

        return ann.token
      },
    },
  ])('closes 4401 a hello with $name, and registers nothing', async ({ token }) => {
    const fixture = await connect()

    await hello(fixture.connection, await token(fixture))

    expect(fixture.socket.closes).toEqual([[CLOSE.unauthorized, 'the session was not accepted']])
    expect(fixture.socket.sent).toEqual([])
    expect(fixture.connections.forIdentity(fixture.ann.identity.id)).toEqual([])
    expect(fixture.seen).toEqual([])
  })

  it("closes 4401 a hello under another device than its session's, and registers nothing", async () => {
    const { socket, connection, ann, connections, seen } = await connect()

    await hello(connection, ann.token, 'device-phone')

    expect(socket.closes).toEqual([[CLOSE.unauthorized, 'no session for this device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    expect(seen).toEqual([])
  })

  it('closes as a failed server a hello whose session could not be read, and welcomes it once it can', async () => {
    const failure = dataError('data:QUERY_FAILED', 'the session could not be read')
    const fixture = await connect({ read: async () => ({ kind: 'failed', error: failure }) })

    await hello(fixture.connection, fixture.ann.token)

    expect(fixture.socket.closes.map(([code]) => code)).toEqual([SERVER_ERROR])
    expect(types(fixture.socket.sent)).toEqual(['error'])
    expect(reported.splice(0)).toEqual([failure])
    expect(fixture.connections.forIdentity(fixture.ann.identity.id)).toEqual([])

    const retry = open(fixture)

    await hello(retry.connection, fixture.ann.token)

    expect(types(retry.socket.sent)).toEqual(['welcome'])
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

  it('signs the device out over its channel: its session ended, its regions left, closed with 4000', async () => {
    const { socket, connection, ann, region, hub, clock, sessions, connections, logLines } =
      await connectedAsAnn()

    await connection.receive(encode({ type: 'subscribe', region, vv: null }))
    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    // The session the hello came with ended: its token reads none from now on.
    expect(await sessions.read(ann.token)).toEqual({ kind: 'none' })
    expect(logLines).toEqual([])

    // Nobody subscribes to the region any more, so it unloads after the idle time.
    expect(hub.loadedRegions()).toBe(1)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)
  })

  it('refuses the registration of a hello of the device that read its session before a sign-out over its channel ended it', async () => {
    const held = heldRead()
    const fixture = await connectedAsAnn()
    const racing = open(fixture, { read: held.read })
    const helloed = hello(racing.connection, fixture.ann.token)

    // The racing hello read a live session and waits; the welcomed socket signs out meanwhile.
    await held.reached
    await fixture.connection.receive(encode({ type: 'sign-out', scope: 'device' }))
    held.release()
    await helloed

    expect(fixture.socket.closes).toEqual([[CLOSE.signedOut, 'signed out']])
    expect(racing.socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(racing.socket.sent).toEqual([])
    expect(fixture.connections.forIdentity(fixture.ann.identity.id)).toEqual([])
    expect(await fixture.sessions.read(fixture.ann.token)).toEqual({ kind: 'none' })
  })

  it('closes as a failed server, never as signed out, when the session cannot be ended', async () => {
    const { socket, connection, ann, sessions, connections, logLines } = await connectedAsAnn({
      signOut: () => errAsync(dataError('data:WRITE_FAILED', 'the directory went away')),
    })
    const epoch = connections.epoch()

    await connection.receive(encode({ type: 'sign-out', scope: 'device' }))

    expect(socket.closes).toEqual([[SERVER_ERROR, 'revoke failed']])
    // Nothing is closed through the registry: the device's next hello is welcomed as before.
    expect(connections.epoch()).toBe(epoch)
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 40, identity: ann.identity.id, code: 'data:WRITE_FAILED' }),
    ])
    // The session lives on: the device sends its sign-out again through the route.
    expect((await sessions.read(ann.token)).kind).toBe('session')
    expect([...logLines, ...socket.closes.map(([, reason]) => reason)].join('\n')).not.toContain(
      ann.token,
    )
  })

  it('closes a socket that never says hello with the timeout code, not as a refused session', async () => {
    const { socket, clock } = await connect()

    await clock.advance(9_999)
    expect(socket.closedWith).toBeUndefined()

    await clock.advance(1)
    expect(CLOSE.timeout).toBe(4408)
    expect(socket.closedWith?.[0]).toBe(CLOSE.timeout)
  })

  it("closes the device's older socket once a newer hello of it is welcomed, without signing it out", async () => {
    const fixture = await connectedAsAnn()
    const newer = open(fixture)

    await hello(newer.connection, fixture.ann.token)

    expect(fixture.socket.closes).toEqual([[1000, 'another connection of this device took over']])
    expect(types(newer.socket.sent)).toEqual(['welcome'])
    expect(newer.socket.closes).toEqual([])
    expect((await fixture.sessions.read(fixture.ann.token)).kind).toBe('session')
    expect(fixture.connections.forIdentity(fixture.ann.identity.id)).toEqual([newer.connection])
  })

  it('closes 4400 a hello that names no device, without reading its session', async () => {
    const { socket, connection, ann, reads } = await connect()

    // The protocol's encoder cannot write a hello without its device.
    await connection.receive(
      JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: ann.token }),
    )

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
    expect(socket.sent).toEqual([])
    expect(reads).toEqual([])
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

    await hello(connection, signedUp.token)

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
    const helloed = hello(connection, signedUp.token)

    await reached
    await gateway.connections.close(signedUp.identity.id, undefined, CLOSE.revoked)

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])

    heads.release()
    await helloed

    expect(socket.sent).toEqual([])
  })

  it('closes 4001 a hello whose device is signed out from another one once its session was read', async () => {
    const held = heldRead()
    const { socket, connection, ann, connections, sessions, seen } = await connect({
      read: held.read,
    })
    const helloed = hello(connection, ann.token)
    const read = await sessions.read(ann.token)
    const session = read.kind === 'session' ? read.caller.session : expect.unreachable('a session')

    await held.reached
    // As the route does: the session first, then the sockets.
    ;(await sessions.revoke(ann.identity.id, session))._unsafeUnwrap()
    await connections.close(ann.identity.id, DEVICE, CLOSE.revoked)
    held.release()
    await helloed

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    expect(seen).toEqual([])
  })

  it('closes a welcomed socket of the device with 1000 once a new sign-in of the device is answered', async () => {
    const { socket, ann, connections, sessions, signInAgain } = await connectedAsAnn()

    expect(types(socket.sent)).toEqual(['welcome'])
    expect(await signInAgain(ann.identity)).toBe(200)

    expect(socket.closes).toEqual([[1000, 'another connection of this device took over']])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    // The new sign-in ended the session the socket held.
    expect(await sessions.read(ann.token)).toEqual({ kind: 'none' })
  })

  it('refuses a hello holding the earlier token of its device, read before a new sign-in of the device was answered', async () => {
    const held = heldRead()
    const { socket, connection, ann, connections, signInAgain, seen } = await connect({
      read: held.read,
    })
    const helloed = hello(connection, ann.token)

    await held.reached
    expect(await signInAgain(ann.identity)).toBe(200)
    held.release()
    await helloed

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    expect(seen).toEqual([])
  })

  it('closes 4001 a hello whose identity is signed out everywhere once its session was read', async () => {
    const held = heldRead()
    const { socket, connection, ann, connections, sessions } = await connect({ read: held.read })
    const helloed = hello(connection, ann.token)

    await held.reached
    // As the route does: every session of the identity first, then its sockets.
    ;(await sessions.revokeAll(ann.identity.id))._unsafeUnwrap()
    await connections.close(ann.identity.id, undefined, CLOSE.revoked)
    held.release()
    await helloed

    expect(socket.closes).toEqual([[CLOSE.revoked, 'signed out from another device']])
    expect(socket.sent).toEqual([])
    expect(connections.forIdentity(ann.identity.id)).toEqual([])
    expect(await sessions.read(ann.token)).toEqual({ kind: 'none' })
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

    await hello(connection, ann.token)

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
  })

  it('handles each message after the ones before it, a subscribe sent with the hello too', async () => {
    const { socket, connection, ann, region } = await connect()

    await Promise.all([
      hello(connection, ann.token),
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

    await hello(connection, anns.token)

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

  it('welcomes a member without the region of an organisation whose database cannot be read, and logs it', async () => {
    const { gateway, anns, acme } = await withAcme(false)
    const failure = dataError('data:OPEN_FAILED', 'could not open the database of acme')
    const { socket, connection, logLines } = open(gateway, {
      hub: {
        heads: (regions) =>
          regions.includes('tenant:acme') ? errAsync(failure) : gateway.hub.heads(regions),
      },
    })

    await hello(connection, anns.token)

    // The membership stays: the device knows the organisation and leaves its region alone.
    expect(socket.sent).toEqual([
      {
        type: 'welcome',
        identity: anns.identity.id,
        regions: [{ region: `identity:${anns.identity.id}`, head: 0 }],
        memberships: [acme],
        time: 0,
      },
    ])
    expect(socket.closedWith).toBeUndefined()
    expect(logLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 50, region: 'tenant:acme', code: 'data:OPEN_FAILED' }),
    ])
  })

  it('closes as a failed server a hello whose own region cannot be read, whatever the organisations', async () => {
    const { gateway, anns } = await withAcme(false)
    const failure = dataError('data:QUERY_FAILED', 'could not read the heads of regions')
    const { socket, connection } = open(gateway, {
      hub: {
        heads: (regions) =>
          regions.includes(`identity:${anns.identity.id}`)
            ? errAsync(failure)
            : gateway.hub.heads(regions),
      },
    })

    await hello(connection, anns.token)

    expect(types(socket.sent)).toEqual(['error'])
    expect(socket.closes.map(([code]) => code)).toEqual([SERVER_ERROR])
    expect(reported.splice(0)).toEqual([failure])
  })

  it('closes 4403 a subscribe to the region of an organisation the identity is not a member of', async () => {
    const { gateway, bobs } = await withAcme(false)
    const { socket, connection } = open(gateway)

    await hello(connection, bobs.token)
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

    await hello(connection, bobs.token)
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
      await hello(device.connection, signedUp.token)
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

  it.each([1, PROTOCOL_VERSION - 1])(
    'closes 4400 a hello of protocol %i without reading its session; the token is welcomed at this one',
    async (protocol) => {
      const fixture = await connect()

      await fixture.connection.receive(helloOfProtocol(protocol, fixture.ann.token))

      expect(fixture.socket.closes.map(([code]) => code)).toEqual([CLOSE.protocol])
      expect(fixture.socket.sent).toEqual([])
      expect(fixture.reads).toEqual([])

      const current = open(fixture)

      await hello(current.connection, fixture.ann.token)

      expect(types(current.socket.sent)).toEqual(['welcome'])
    },
  )

  it('sends memberships and leaves the region when the identity is removed', async () => {
    const { gateway, anns, bobs } = await withAcme(true)
    const annsDevice = open(gateway)
    const bobsDevice = open(gateway)

    for (const [device, signedUp] of [
      [annsDevice, anns],
      [bobsDevice, bobs],
    ] as const) {
      await hello(device.connection, signedUp.token)
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

    await hello(connection, bobs.token)
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

    await hello(connection, bobs.token)
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
      await hello(device.connection, signedUp.token)
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

    await hello(connection, bobs.token)
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
      await hello(device.connection, signedUp.token)
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
    const helloed = hello(connection, bobs.token)

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
