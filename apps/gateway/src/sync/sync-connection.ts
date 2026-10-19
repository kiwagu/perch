import type { Result } from 'neverthrow'
import { match, P } from 'ts-pattern'

import { type AuthTokens, type AuthUser, type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { type Ability, defineAbilityFor, NO_ABILITY, OWNER_ABILITY } from '@workspace/kernel'
import type { Logger } from '@workspace/logger'
import {
  type Clock,
  identityRegions,
  type RegionRef,
  type ReplicaSchema,
  tenantKeyOf,
} from '@workspace/replica'
import {
  CLOSE,
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'
import type { Actor, RegionHub, Subscriber } from '@workspace/replica/server'

import type { DeviceSessions } from '../auth/device-sessions'
import {
  grantIdOf,
  type IdentitySessions,
  keysRefused,
  type RenewalGate,
} from '../auth/identity-sessions'
import type { Organisations } from '../tenants/organisations'

import type { ConnectionRegistry } from './connections'
import { acceptKeys, bindDevice, TRY_AGAIN_LATER } from './hello-keys'
import { HelloRenewals } from './hello-renewals'

/** The end of a device's WebSocket the connection writes to. */
export interface SocketLike {
  send(text: string): void
  close(code: number, reason: string): void
}

export interface SyncConnectionDeps {
  readonly sessions: Pick<IdentitySessions, 'authenticate' | 'park' | 'parked' | 'unpark'>
  /**
   * The devices' rows: a hello is bound to its device's row (moved to the new grant when the
   * hello renews the pair), the device is marked seen at its hello and then at most every five
   * minutes, and a sign-out marks the row and revokes the device's grant.
   */
  readonly devices: Pick<DeviceSessions, 'seen' | 'bind' | 'rotate' | 'revokeGrant' | 'signedOut'>
  readonly hub: Pick<RegionHub, 'subscribe' | 'unsubscribe' | 'pull' | 'push' | 'heads' | 'compact'>
  readonly organisations: Pick<Organisations, 'membershipsOf'>
  /** Where the connection registers once the keys are accepted, to hear its memberships change. */
  readonly connections: ConnectionRegistry
  readonly clock: Clock
  /** The gate a hello of `device` asks before its refresh key is exchanged: the renewal limits. */
  readonly renewals: (device: string) => RenewalGate
  /** Hears sign-outs and failures; no line carries a token, a key or a grant id. */
  readonly log: Logger
  /** How long a device may stay silent before its hello; 10 s by default. */
  readonly helloTimeoutMs?: number
  /**
   * Hears each failure the connection did not expect; the device was answered with an
   * internal error and its socket closed. Logged at error level by default.
   */
  readonly onError?: (error: DataError) => void
  /** Who may write what in each region: the abilities of a member are built from it. */
  readonly schema: ReplicaSchema
}

/** A region the device may name, and who it pushes there as. */
interface DeviceRegion {
  readonly ref: RegionRef
  readonly actor: Actor
}

/** A device whose keys were accepted. */
interface Device {
  /** The id the device named itself with in its hello. */
  readonly id: string
  readonly identity: AuthUser
  /** The keys it holds now: renewed at hello, or as it came with them. */
  readonly tokens: AuthTokens
  /**
   * The regions the device may name, by id: the identity's private region as its owner, and the
   * region of each organisation it belongs to with the member's role.
   */
  readonly regions: ReadonlyMap<string, DeviceRegion>
}

type State =
  | { readonly kind: 'waiting'; readonly cancelHello: () => void }
  | { readonly kind: 'ready'; readonly device: Device }
  | { readonly kind: 'closed' }

/** The close code of a server that failed (RFC 6455). */
const SERVER_ERROR = 1011

/** How often at most a device is marked seen while it keeps talking. */
const SEEN_EVERY_MS = 5 * 60_000

/** The hello of a device. */
type Hello = Extract<ClientMessage, { readonly type: 'hello' }>

/** Close reasons are fixed texts: a reason never repeats what the device sent. */
const REASON = {
  malformed: 'the message does not follow the protocol',
  helloFirst: 'the first message must be hello',
  helloTwice: 'hello was already said',
  silent: 'no hello in time',
  refused: 'the keys were not accepted',
  tooManyRenewals: 'too many renewals',
  noSession: 'no session for this device',
  forbidden: 'the region is not open to this device',
  signedOut: 'signed out',
  revoked: 'signed out from another device',
  revokeFailed: 'revoke failed',
  failed: 'the gateway failed to handle the message',
} as const

/**
 * The regions an identity may name, by id, with what it may do in each: everything in its private
 * region, what its role allows in each organisation's region, nothing in a region without a role.
 */
export function regionsFor(
  identity: string,
  memberships: readonly Membership[],
  schema: ReplicaSchema,
): ReadonlyMap<string, DeviceRegion> {
  const roles = new Map(memberships.map((membership) => [membership.tenant.key, membership.role]))

  return new Map(
    identityRegions(identity, memberships).map((ref) => {
      const key = tenantKeyOf(ref)
      const role = key === undefined ? undefined : roles.get(key)
      // Only the private region is the identity's own; a tenant region without a role allows nothing.
      const ability: Ability =
        ref.kind === 'private'
          ? OWNER_ABILITY
          : role === undefined
            ? NO_ABILITY
            : defineAbilityFor({ id: identity, role }, schema)

      return [ref.id, { ref, actor: { id: identity, ability } }]
    }),
  )
}

/** The regions a message names. */
function regionsOf(message: ClientMessage): readonly string[] {
  return match(message)
    .with({ type: P.union('hello', 'sign-out') }, () => [])
    .with({ type: 'probe' }, ({ regions }) => regions)
    .with({ type: P.union('subscribe', 'pull', 'push', 'compact') }, ({ region }) => [region])
    .exhaustive()
}

/**
 * One device's WebSocket to the gateway. The device says hello with its keys first, within
 * the hello time; once they are accepted it is welcomed with its identity's private region,
 * the region of each organisation the identity belongs to and those memberships, and may
 * subscribe, pull, push, probe and compact in those regions only, each handed to the region
 * hub, which answers the device itself and checks its batches against the identity. Messages
 * are handled one at a time, in the order they came. A change of the identity's memberships
 * does not wait for them: the device leaves the regions it may no longer name at once, so a
 * message handled from then on that names one is refused and the hub sends it nothing more
 * there (what is under way finishes), may name the new ones, and is sent the memberships; a
 * revocation takes one region away the same way without a message. A change told while the
 * hello is under way applies right after the welcome. Text the protocol refuses closes the
 * socket, a hello that names no device among it; so does a region the device may not name and a
 * sign-out, which marks the device's row signed out, forgets the pairs parked for it and revokes
 * its refresh grant through the database, as the sign-out route does: the sign-out close (4000)
 * means the grant is revoked, and a row that cannot be marked or a grant that cannot be revoked
 * closes the socket as a failed server (1011) instead. A device signed out from another one is
 * closed at once with 4001, whatever it is doing. Keys the database refuses close the hello with
 * 4401; keys it could not judge, as a failed server (1011), and a renewal the limits refused, with
 * 1013 (try again later): the device comes back with them.
 * A hello is bound to its device's row: a device without one is closed with 4401, a device
 * signed out with 4001, and a pair renewed for either is revoked at once; a renewal moves the row
 * to the new grant. A pair renewed at a hello whose socket closed before it could take it is
 * parked for the device's next hello with the spent refresh key, which is sent it before its
 * welcome. The device is marked seen at its hello and then at most every five minutes it talks.
 */
export class SyncConnection {
  readonly #socket: SocketLike
  readonly #sessions: SyncConnectionDeps['sessions']
  readonly #devices: SyncConnectionDeps['devices']
  readonly #hub: SyncConnectionDeps['hub']
  readonly #organisations: SyncConnectionDeps['organisations']
  readonly #connections: ConnectionRegistry
  readonly #clock: Clock
  readonly #schema: ReplicaSchema
  readonly #log: Logger
  readonly #onError: (error: DataError) => void
  readonly #renewals: HelloRenewals
  readonly #renewalGate: SyncConnectionDeps['renewals']
  readonly #subscriber: Subscriber
  /** The regions the device subscribed to, to leave when the socket closes. */
  readonly #subscribed = new Set<string>()
  #state: State
  /** Settles once every message so far has been handled. */
  #queue: Promise<void> = Promise.resolve()
  /** Takes the connection out of the registry; nothing to take until the keys are accepted. */
  #unregister: () => void = () => {}
  /** The changes of memberships told while the hello is under way, applied after the welcome. */
  readonly #afterWelcome: Array<() => void> = []
  /** Resolves once the hello settled: the device was welcomed, or the socket closed. */
  readonly #helloSettled: Promise<void>
  #settleHello: () => void = () => {}
  /** When the device was last marked seen, on the clock. */
  #seenAt = 0

  constructor(socket: SocketLike, deps: SyncConnectionDeps) {
    this.#socket = socket
    this.#sessions = deps.sessions
    this.#devices = deps.devices
    this.#hub = deps.hub
    this.#organisations = deps.organisations
    this.#connections = deps.connections
    this.#clock = deps.clock
    this.#schema = deps.schema
    this.#log = deps.log
    this.#onError = deps.onError ?? ((error) => deps.log.error({ code: error.code }, error.message))
    this.#renewals = new HelloRenewals(deps)
    this.#renewalGate = deps.renewals
    this.#subscriber = {
      id: crypto.randomUUID(),
      send: (message) => this.#send(message),
    }
    this.#helloSettled = new Promise((resolve) => {
      this.#settleHello = resolve
    })
    this.#state = {
      kind: 'waiting',
      // A late hello is no sign of bad keys: the device connects again and says it in time.
      cancelHello: deps.clock.schedule(deps.helloTimeoutMs ?? 10_000, () =>
        this.#close(CLOSE.timeout, REASON.silent),
      ),
    }
  }

  /** Handles one text message once the ones before it are handled; never rejects. */
  receive(text: string): Promise<void> {
    return this.#enqueue(() => this.#dispatch(text))
  }

  /**
   * The identity's memberships changed: at once, whatever message is being handled, the device
   * leaves the regions it may no longer name, may name the new ones, and is sent the
   * memberships. Resolves once they were sent, or the socket closed: right after the welcome
   * while the hello is under way. Never rejects.
   */
  memberships(next: readonly Membership[]): Promise<void> {
    return this.#change(() => this.#changeMemberships(next))
  }

  /**
   * The identity left the organisation of `region`: at once, whatever message is being
   * handled, the device may no longer name it and leaves it. Nothing is sent: the memberships
   * follow. Resolves once that holds; while the hello is under way it applies right after the
   * welcome, before any later message is handled. Never rejects.
   */
  revoke(region: string): Promise<void> {
    void this.#change(() => this.#leave(region))

    return Promise.resolve()
  }

  /**
   * The device was signed out from another device: the socket closes with `code` at once,
   * whatever message is being handled and also while the hello is under way, before its welcome.
   * Resolves once it closed. Never rejects.
   */
  end(code: number): Promise<void> {
    this.#close(code, REASON.revoked)

    return Promise.resolve()
  }

  /** The socket closed: leaves every region, unregisters and ignores whatever comes later. */
  closed(): void {
    if (this.#state.kind === 'waiting') {
      this.#state.cancelHello()
    }

    this.#state = { kind: 'closed' }
    this.#unregister()
    this.#afterWelcome.length = 0
    this.#settleHello()

    for (const region of this.#subscribed) {
      this.#hub.unsubscribe(region, this.#subscriber.id)
    }

    this.#subscribed.clear()
  }

  /** Runs `work` once the work before it is done; never rejects. */
  #enqueue(work: () => Promise<void>): Promise<void> {
    const handled = this.#queue.then(() => this.#handle(work))

    this.#queue = handled

    return handled
  }

  /**
   * Applies a change of the device's regions now, outside the queue of messages; while the
   * hello is under way it waits for the welcome. Resolves once applied, or the socket closed.
   */
  #change(apply: () => void): Promise<void> {
    if (this.#state.kind === 'waiting') {
      this.#afterWelcome.push(apply)

      return this.#helloSettled
    }

    this.#guarded(apply)

    return Promise.resolve()
  }

  /** Runs `apply`; a send that throws fails the connection, as in the queue. */
  #guarded(apply: () => void): void {
    try {
      apply()
    } catch (cause) {
      this.#fail(dataError('data:WRITE_FAILED', 'the sync connection failed to answer', cause))
    }
  }

  async #handle(work: () => Promise<void>): Promise<void> {
    if (this.#state.kind === 'closed') {
      return
    }

    try {
      await work()
    } catch (cause) {
      this.#fail(dataError('data:WRITE_FAILED', 'the sync connection failed to answer', cause))
    }
  }

  async #dispatch(text: string): Promise<void> {
    const decoded = decodeMessage(clientMessage, text)

    if (decoded.isErr()) {
      this.#close(CLOSE.protocol, REASON.malformed)

      return
    }

    const message = decoded.value
    const state = this.#state

    if (state.kind === 'waiting') {
      if (message.type !== 'hello') {
        this.#close(CLOSE.protocol, REASON.helloFirst)

        return
      }

      state.cancelHello()
      await this.#hello(message)

      return
    }

    if (state.kind === 'ready') {
      this.#seen(state.device)
      await this.#serve(state.device, message)
    }
  }

  async #hello(hello: Hello): Promise<void> {
    const { access, refresh, device: deviceId } = hello
    const accepted = await acceptKeys(
      this.#sessions,
      { device: deviceId, access, refresh },
      this.#renewalGate(deviceId),
    )

    if (accepted.isErr()) {
      // Keys the database could not judge are not refused: the device keeps them and comes back,
      // as it does after a renewal the limits refused, which is not logged.
      if (keysRefused(accepted.error)) {
        this.#close(CLOSE.unauthorized, REASON.refused)
      } else if (accepted.error.code === 'data:RATE_LIMITED') {
        this.#close(TRY_AGAIN_LATER, REASON.tooManyRenewals)
      } else {
        this.#fail(accepted.error)
      }

      return
    }

    const { identity, deliver, spent } = accepted.value
    // Read once the keys are accepted and before the row is: a sign-out of the device from now
    // on refuses the registration, one before is seen by the read.
    const epoch = this.#connections.epoch(identity.id, deviceId)

    if (this.#isClosed() && spent === undefined) {
      // A parked pair the socket closed before it could take waits again for the next hello.
      if (deliver && refresh !== undefined) {
        this.#renewals.park(identity.id, deviceId, refresh, deliver)
      }

      return
    }

    const binding = await bindDevice(this.#devices, {
      identity: identity.id,
      device: deviceId,
      accepted: accepted.value,
    })
    const bound = binding.isOk() && binding.value.kind === 'bound'

    // A pair renewed for a device that has no session must not live: nobody may take it.
    if (spent !== undefined && deliver && !bound) {
      await this.#renewals.drop(identity.id, deliver)
    }

    if (this.#isClosed()) {
      // The device's refresh key is spent and the pair that replaces it cannot reach it now: it
      // waits for the device's next hello with that key.
      if (bound && deliver && refresh !== undefined) {
        this.#renewals.park(identity.id, deviceId, refresh, deliver)
      }

      return
    }

    if (binding.isErr()) {
      this.#fail(binding.error)

      return
    }

    const kind = binding.value.kind

    if (kind === 'revoked') {
      this.#close(CLOSE.revoked, REASON.revoked)

      return
    }

    if (kind !== 'bound') {
      this.#close(CLOSE.unauthorized, REASON.noSession)

      return
    }

    // The new pair goes out first, before anything else is awaited: the key the device holds
    // is spent already.
    if (deliver) {
      this.#send({ type: 'tokens', access: deliver.access, refresh: deliver.refresh })
    }

    // Registered before the memberships are read: a change from then on reaches the device
    // after its welcome, in turn with its messages. A sign-out of the device since the epoch was
    // read refuses it.
    const unregister = this.#connections.add(identity.id, deviceId, this, epoch)

    if (!unregister) {
      this.#close(CLOSE.revoked, REASON.revoked)

      return
    }

    this.#unregister = unregister

    // A renewal marked the device seen as it moved the row to the new grant.
    if (spent === undefined) {
      this.#markSeen(identity.id, deviceId)
    } else {
      this.#seenAt = this.#clock.now()
    }

    const memberships = await this.#organisations.membershipsOf(identity.id)

    if (this.#isClosed()) {
      return
    }

    if (memberships.isErr()) {
      this.#fail(memberships.error)

      return
    }

    const device: Device = {
      id: deviceId,
      identity,
      tokens: accepted.value.tokens,
      regions: regionsFor(identity.id, memberships.value, this.#schema),
    }
    const heads = await this.#hub.heads([...device.regions.keys()])

    if (this.#isClosed()) {
      return
    }

    if (heads.isErr()) {
      this.#fail(heads.error)

      return
    }

    this.#state = { kind: 'ready', device }
    this.#send({
      type: 'welcome',
      identity: identity.id,
      regions: heads.value.map(({ region, head }) => ({ region, head })),
      memberships: [...memberships.value],
      time: this.#clock.now(),
    })

    // What changed since the memberships were read applies before any later message is handled.
    for (const apply of this.#afterWelcome.splice(0)) {
      this.#guarded(apply)
    }

    this.#settleHello()
  }

  /** Leaves the regions the device may no longer name, replaces its regions and tells it. */
  #changeMemberships(next: readonly Membership[]): void {
    const state = this.#state

    if (state.kind !== 'ready') {
      return
    }

    const regions = regionsFor(state.device.identity.id, next, this.#schema)

    for (const region of [...this.#subscribed]) {
      if (!regions.has(region)) {
        this.#unsubscribe(region)
      }
    }

    this.#state = { kind: 'ready', device: { ...state.device, regions } }
    this.#send({ type: 'memberships', memberships: [...next] })
  }

  /** Takes `region` from the regions the device may name, and leaves it at the hub. */
  #leave(region: string): void {
    const state = this.#state

    if (state.kind !== 'ready') {
      return
    }

    const regions = new Map(state.device.regions)

    regions.delete(region)
    this.#state = { kind: 'ready', device: { ...state.device, regions } }

    if (this.#subscribed.has(region)) {
      this.#unsubscribe(region)
    }
  }

  #unsubscribe(region: string): void {
    this.#hub.unsubscribe(region, this.#subscriber.id)
    this.#subscribed.delete(region)
  }

  async #serve(device: Device, message: ClientMessage): Promise<void> {
    if (!regionsOf(message).every((region) => device.regions.has(region))) {
      this.#send({ type: 'error', code: 'forbidden-region', message: REASON.forbidden })
      this.#close(CLOSE.forbidden, REASON.forbidden)

      return
    }

    const subscriber = this.#subscriber

    await match(message)
      .with({ type: 'hello' }, async () => this.#close(CLOSE.protocol, REASON.helloTwice))
      .with({ type: 'sign-out' }, () => this.#signOut(device))
      .with({ type: 'subscribe' }, async ({ region, vv }) => {
        const entry = device.regions.get(region)

        // Checked above: the device may name the region.
        if (entry) {
          this.#subscribed.add(region)
          this.#settle(await this.#hub.subscribe(entry.ref, entry.actor, subscriber, vv))
        }
      })
      .with({ type: 'pull' }, async ({ region, vv }) => {
        this.#settle(await this.#hub.pull(region, subscriber, vv))
      })
      .with({ type: 'push' }, async ({ region, batch, updates }) => {
        this.#settle(await this.#hub.push(region, subscriber, batch, updates))
      })
      .with({ type: 'compact' }, async ({ region, covers, snapshot }) => {
        this.#settle(await this.#hub.compact(region, subscriber, covers, snapshot))
      })
      .with({ type: 'probe' }, async ({ regions }) => {
        const heads = await this.#hub.heads(regions)

        if (this.#isClosed()) {
          return
        }

        if (heads.isErr()) {
          this.#fail(heads.error)

          return
        }

        this.#send({ type: 'heads', regions: [...heads.value], time: this.#clock.now() })
      })
      .exhaustive()
  }

  /**
   * Leaves the device's regions, marks its row signed out, forgets the pairs parked for it and
   * revokes its refresh grant through the database, as the sign-out route does, then closes as
   * signed out. A device without a refresh grant (it came with an access token only) has none to
   * revoke. A row that cannot be marked or a grant that cannot be revoked is logged with its code,
   * and the socket closes as a failed server: the device must not take the sign-out close for a
   * revoked grant, and sends the sign-out again through the route, which completes it.
   */
  async #signOut(device: Device): Promise<void> {
    for (const region of this.#subscribed) {
      this.#hub.unsubscribe(region, this.#subscriber.id)
    }

    this.#subscribed.clear()

    const identity = device.identity.id
    const { refresh } = device.tokens
    const grant = refresh === undefined ? undefined : grantIdOf(refresh)

    if (grant === undefined) {
      this.#log.info({ identity }, 'device signed out without a refresh grant: nothing to revoke')
      this.#close(CLOSE.signedOut, REASON.signedOut)

      return
    }

    const marked = await this.#devices.signedOut({ identity, grant })

    if (marked.isErr()) {
      this.#log.warn(
        { identity, code: marked.error.code },
        'the row of a device that signed out could not be marked',
      )
      this.#close(SERVER_ERROR, REASON.revokeFailed)

      return
    }

    this.#sessions.unpark(identity, device.id)

    const revoked = await this.#devices.revokeGrant({ identity, grant })

    if (revoked.isErr()) {
      this.#log.warn(
        { identity, code: revoked.error.code },
        'the refresh grant of a device that signed out could not be revoked',
      )
      this.#close(SERVER_ERROR, REASON.revokeFailed)

      return
    }

    this.#close(CLOSE.signedOut, REASON.signedOut)
  }

  /** Marks the device seen when it was not for five minutes. */
  #seen(device: Device): void {
    if (this.#clock.now() - this.#seenAt >= SEEN_EVERY_MS) {
      this.#markSeen(device.identity.id, device.id)
    }
  }

  /**
   * Marks the device seen now, without waiting: a failure is logged, with the identity and the
   * code only, and changes nothing for the device.
   */
  #markSeen(identity: IdentityId, device: string): void {
    this.#seenAt = this.#clock.now()
    void this.#devices.seen({ identity, device }).match(
      () => undefined,
      (error) => {
        this.#log.warn({ identity, code: error.code }, 'the device could not be marked seen')
      },
    )
  }

  /**
   * The hub answers the device itself, failures included, and resolves without an error;
   * an error it returns all the same was not expected.
   */
  #settle(result: Result<void, DataError>): void {
    if (result.isErr()) {
      this.#fail(result.error)
    }
  }

  /** Reports a failure the connection did not expect, answers it and closes as a failed server. */
  #fail(error: DataError): void {
    this.#onError(error)

    try {
      this.#send({ type: 'error', code: 'internal', message: REASON.failed })
    } catch {
      // The socket that could not take the answer is closed below; the failure is reported.
    }

    this.#close(SERVER_ERROR, REASON.failed)
  }

  #send(message: ServerMessage): void {
    this.#socket.send(encodeMessage(serverMessage, message))
  }

  #close(code: number, reason: string): void {
    if (this.#isClosed()) {
      return
    }

    this.closed()
    this.#socket.close(code, reason)
  }

  #isClosed(): boolean {
    return this.#state.kind === 'closed'
  }
}
