import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { createAuth, type DataError, dataError, type LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { profileIdFactory } from '@workspace/ids'
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

import { type DeviceTokens, IdentitySessions } from '../auth/identity-sessions'
import { DIRECTORY, NAMESPACE } from '../config'

import { profileCreate } from './__fixtures__/profile'
import { type SocketLike, SyncConnection, type SyncConnectionDeps } from './sync-connection'

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

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

interface Opened {
  readonly hub: RegionHub
  readonly local: LocalDb
}

const opened: Opened[] = []

/** Failures the hub, the identity sessions or the connection reported; a test that expects one takes it. */
const reported: DataError[] = []

afterEach(async () => {
  for (const { hub, local } of opened.splice(0)) {
    await hub.close()
    await local.close()
  }

  expect(reported.splice(0)).toEqual([])
})

function encode(message: ClientMessage): string {
  return encodeMessage(clientMessage, message)
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

/**
 * A connection over a fake socket, with a real hub and real identity sessions on a fresh
 * embedded database where Ann has signed up. Revoking a grant is only counted: it goes to
 * the database's RPC over HTTP.
 */
async function connect(options: ConnectOptions = {}) {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()
  const clock = manualClock()
  const hub = new RegionHub({
    local,
    schema: replicaSchema,
    clock,
    onError: (error) => reported.push(error),
  })

  opened.push({ hub, local })

  const sessions = new IdentitySessions({
    openAuth: () =>
      createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
    rpcUrl: 'http://127.0.0.1:8000/rpc',
    fetch: Object.assign(() => Promise.reject(new TypeError('no network in this test')), {
      preconnect: () => {},
    }),
    onCloseFailure: (error) => reported.push(error),
  })
  const signedUp = (await sessions.signUp(ann))._unsafeUnwrap()
  const revoked: DeviceTokens[] = []
  const logLines: string[] = []
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
      unsubscribe: hub.unsubscribe.bind(hub),
      pull: hub.pull.bind(hub),
      push: hub.push.bind(hub),
      heads: hub.heads.bind(hub),
      compact: hub.compact.bind(hub),
      ...options.hub,
    },
    clock,
    log: createLogger('sync', {
      level: 'info',
      format: 'json',
      destination: { write: (line) => logLines.push(line) },
    }),
    onError: (error) => reported.push(error),
  })

  return {
    socket,
    connection,
    clock,
    hub,
    ann: signedUp,
    region: `identity:${signedUp.identity.id}`,
    revoked,
    logLines,
  }
}

/** A connection where Ann said hello with the pair her sign-up gave her. */
async function connectedAsAnn(options: ConnectOptions = {}) {
  const fixture = await connect(options)
  const { access, refresh } = fixture.ann.tokens

  await fixture.connection.receive(
    encode({ type: 'hello', protocol: PROTOCOL_VERSION, access, refresh }),
  )

  return { ...fixture, doc: RegionDoc.inMemory('private', fixture.region) }
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

    await connection.receive(encode({ type: 'hello', protocol: 1, access: 'garbage' }))

    expect(socket.closedWith?.[0]).toBe(CLOSE.unauthorized)
    expect(socket.sent).toEqual([])
  })

  it('welcomes a device with its private region and sends renewed keys', async () => {
    const { socket, connection, ann, clock } = await connect()

    await clock.advance(1_000)
    await connection.receive(
      encode({ type: 'hello', protocol: 1, access: 'stale', refresh: ann.tokens.refresh }),
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

    await connection.receive(encode({ type: 'hello', protocol: 1, access: ann.tokens.access }))
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
      encode({ type: 'hello', protocol: 1, access: 'stale', refresh: ann.tokens.refresh }),
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

    await connection.receive(encode({ type: 'hello', protocol: 1, access: ann.tokens.access }))

    expect(socket.closedWith?.[0]).toBe(CLOSE.protocol)
  })

  it('handles each message after the ones before it, a subscribe sent with the hello too', async () => {
    const { socket, connection, ann, region } = await connect()
    const { access, refresh } = ann.tokens

    await Promise.all([
      connection.receive(encode({ type: 'hello', protocol: 1, access, refresh })),
      connection.receive(encode({ type: 'subscribe', region, vv: null })),
      connection.receive(encode({ type: 'probe', regions: [region] })),
    ])

    expect(types(socket.sent)).toEqual(['welcome', 'updates', 'heads'])
    expect(socket.closedWith).toBeUndefined()
  })

  it('ignores messages once the socket closed and leaves its regions', async () => {
    const { socket, connection, region, hub, clock } = await connectedAsAnn()

    await connection.receive(encode({ type: 'subscribe', region, vv: null }))
    connection.closed()
    await connection.receive(encode({ type: 'probe', regions: [region] }))

    expect(types(socket.sent)).toEqual(['welcome', 'updates'])
    expect(socket.closedWith).toBeUndefined()

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
})
