import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock, ReplicaSchema } from '@workspace/replica'
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

import { type DeviceTokens, keysRefused } from '../auth/identity-sessions'

import type { ConnectedDevice, ConnectionState } from './connected-device'
import type { ConnectionHost } from './connection-host'
import { answerFailed, REASON, SERVER_ERROR, SUPERSEDED } from './connection-reasons'
import type { ConnectionRegistry } from './connections'
import { regionsFor } from './device-regions'
import { DeviceRequests } from './device-requests'
import { DeviceSeen } from './device-seen'
import { acceptKeys, bindDevice, TRY_AGAIN_LATER } from './hello-keys'
import { HelloRenewals } from './hello-renewals'
import { RegionChanges } from './region-changes'
import { RegionSubscriptions } from './region-subscriptions'
import type { SocketLike, SyncConnectionDeps } from './sync-connection-deps'

/** The end of a device's WebSocket the connection writes to. */
export type { SocketLike, SyncConnectionDeps } from './sync-connection-deps'

/** The hello of a device. */
type Hello = Extract<ClientMessage, { readonly type: 'hello' }>

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
 * socket, a hello that names no device among it; so do a region the device may not name and a
 * sign-out (`device-requests.ts`). A device signed out from another one is
 * closed at once with 4001, whatever it is doing. Keys the database refuses close the hello with
 * 4401; keys it could not judge, as a failed server (1011), and a renewal the limits refused, with
 * 1013 (try again later): the device comes back with them.
 * A hello is bound to its device's row: a device without one is closed with 4401, a device
 * signed out with 4001, and a pair renewed for either is revoked at once; a renewal moves the row
 * to the new grant. A pair renewed at a hello whose socket closed before it could take it is
 * parked for the device's next hello with the spent refresh key, which is sent it before its
 * welcome. The device is marked seen at its hello and then at most every five minutes it talks.
 * A device holds one live socket: the hello that registers closes its older ones (1000), without
 * signing it out. Its key operations, a hello from its key check to its registration and a renewal
 * over the channel, run one at a time across its sockets, so no two spend one refresh key.
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
  readonly #onError: (error: DataError) => void
  readonly #renewals: HelloRenewals
  readonly #renewalGate: SyncConnectionDeps['renewals']
  readonly #subscriptions: RegionSubscriptions
  readonly #seen: DeviceSeen
  readonly #changes: RegionChanges
  readonly #requests: DeviceRequests
  #state: ConnectionState
  /** Settles once every message so far has been handled. */
  #queue: Promise<void> = Promise.resolve()
  /** Takes the connection out of the registry; nothing to take until the keys are accepted. */
  #unregister: () => void = () => {}

  constructor(socket: SocketLike, deps: SyncConnectionDeps) {
    this.#socket = socket
    this.#sessions = deps.sessions
    this.#devices = deps.devices
    this.#hub = deps.hub
    this.#organisations = deps.organisations
    this.#connections = deps.connections
    this.#clock = deps.clock
    this.#schema = deps.schema
    this.#onError = deps.onError ?? ((error) => deps.log.error({ code: error.code }, error.message))
    this.#renewals = new HelloRenewals(deps)
    this.#renewalGate = deps.renewals
    this.#subscriptions = new RegionSubscriptions(deps.hub, {
      id: crypto.randomUUID(),
      send: (message) => this.#send(message),
    })
    this.#seen = new DeviceSeen(deps)

    const host: ConnectionHost = {
      device: () => (this.#state.kind === 'ready' ? this.#state.device : undefined),
      ready: (device) => {
        this.#state = { kind: 'ready', device }
      },
      isClosed: () => this.#isClosed(),
      send: (message) => this.#send(message),
      sendTokens: (identity, device, held, tokens) =>
        this.#sendTokens(identity, device, held, tokens),
      close: (code, reason) => this.#close(code, reason),
      fail: (error) => this.#fail(error),
    }

    this.#changes = new RegionChanges({
      host,
      subscriptions: this.#subscriptions,
      schema: deps.schema,
      helloUnderWay: () => this.#state.kind === 'waiting',
    })
    this.#requests = new DeviceRequests(deps, {
      host,
      subscriptions: this.#subscriptions,
      seen: this.#seen,
      pairs: this.#renewals,
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
    return this.#changes.memberships(next)
  }

  /**
   * The identity left the organisation of `region`: at once, whatever message is being
   * handled, the device may no longer name it and leaves it. Nothing is sent: the memberships
   * follow. Resolves once that holds; while the hello is under way it applies right after the
   * welcome, before any later message is handled. Never rejects.
   */
  revoke(region: string): Promise<void> {
    return this.#changes.revoke(region)
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

  /**
   * A newer hello of the device took over: the socket closes at once, without signing the device
   * out, and spends none of its keys from then on.
   */
  supersede(): void {
    this.#close(SUPERSEDED, REASON.superseded)
  }

  /** The socket closed: leaves every region, unregisters and ignores whatever comes later. */
  closed(): void {
    if (this.#state.kind === 'waiting') {
      this.#state.cancelHello()
    }

    this.#state = { kind: 'closed' }
    this.#unregister()
    this.#changes.closed()
    this.#subscriptions.leaveAll()
  }

  /** Runs `work` once the work before it is done; never rejects. */
  #enqueue(work: () => Promise<void>): Promise<void> {
    const handled = this.#queue.then(() => this.#handle(work))

    this.#queue = handled

    return handled
  }

  async #handle(work: () => Promise<void>): Promise<void> {
    if (this.#state.kind === 'closed') {
      return
    }

    try {
      await work()
    } catch (cause) {
      this.#fail(answerFailed(cause))
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
      this.#seen.talked(state.device)
      await this.#requests.serve(state.device, message)
    }
  }

  async #hello(hello: Hello): Promise<void> {
    // The keys are checked, renewed and handed over, and the connection takes the device's place,
    // as its one key operation under way: no other socket of the device spends a key meanwhile.
    const entered = await this.#sessions.exclusively(hello.device, () => this.#enter(hello))

    if (entered === undefined) {
      return
    }

    const { identity, tokens } = entered
    const memberships = await this.#organisations.membershipsOf(identity.id)

    if (this.#isClosed()) {
      return
    }

    if (memberships.isErr()) {
      this.#fail(memberships.error)

      return
    }

    const device: ConnectedDevice = {
      id: hello.device,
      identity,
      tokens,
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
    this.#changes.welcomed()
  }

  /**
   * Accepts the hello's keys, hands over a renewed pair and registers the connection in place of
   * the device's older ones, which close. The identity and the keys the device holds now, or
   * undefined once the socket closed.
   */
  async #enter(hello: Hello): Promise<Pick<ConnectedDevice, 'identity' | 'tokens'> | undefined> {
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

      return undefined
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

      return undefined
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

      return undefined
    }

    if (binding.isErr()) {
      this.#fail(binding.error)

      return undefined
    }

    const kind = binding.value.kind

    if (kind === 'revoked') {
      this.#close(CLOSE.revoked, REASON.revoked)

      return undefined
    }

    if (kind !== 'bound') {
      this.#close(CLOSE.unauthorized, REASON.noSession)

      return undefined
    }

    // The new pair goes out first, before anything else is awaited: the key the device holds
    // is spent already.
    if (deliver && !this.#sendTokens(identity.id, deviceId, refresh, deliver)) {
      return undefined
    }

    // Registered before the memberships are read: a change from then on reaches the device
    // after its welcome, in turn with its messages. A sign-out of the device since the epoch was
    // read refuses it.
    const unregister = this.#connections.add(identity.id, deviceId, this, epoch)

    if (!unregister) {
      this.#close(CLOSE.revoked, REASON.revoked)

      return undefined
    }

    this.#unregister = unregister

    // A renewal marked the device seen as it moved the row to the new grant.
    if (spent === undefined) {
      this.#seen.mark(identity.id, deviceId)
    } else {
      this.#seen.renewed()
    }

    // The device holds one live socket: an older one it gave up spends none of its keys.
    this.#connections.supersede(identity.id, deviceId, this)

    return { identity, tokens: accepted.value.tokens }
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

  /** Whether the socket took the message: one it dropped is lost. */
  #send(message: ServerMessage): boolean {
    return this.#socket.send(encodeMessage(serverMessage, message)) !== 0
  }

  /**
   * Sends a pair the device does not hold yet. One a closed socket cannot take, or one the socket
   * dropped or threw on, is parked (`deliver`), and an open socket closes so the device comes back.
   */
  #sendTokens(
    identity: IdentityId,
    device: string,
    held: string | undefined,
    tokens: DeviceTokens,
  ) {
    const sent = this.#renewals.deliver(
      { identity, device, held, tokens },
      (pair) =>
        !this.#isClosed() &&
        this.#send({ type: 'tokens', access: pair.access, refresh: pair.refresh }),
    )

    if (!sent) {
      this.#close(SERVER_ERROR, REASON.failed)
    }

    return sent
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
