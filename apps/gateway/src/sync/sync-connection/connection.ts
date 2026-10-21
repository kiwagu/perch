import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import {
  CLOSE,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'

import type { DeviceTokens } from '../../auth/identity-sessions'

import type { ConnectionState } from './connected-device'
import type { SocketLike, SyncConnectionDeps } from './deps'
import { DeviceSeen } from './device-seen'
import { ConnectionHello } from './hello'
import { HelloRenewals } from './hello-renewals'
import type { ConnectionHost } from './host'
import { answerFailed, REASON, SERVER_ERROR, SUPERSEDED } from './reasons'
import { RegionChanges } from './region-changes'
import { RegionSubscriptions } from './region-subscriptions'
import { DeviceRequests } from './requests'

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
 * sign-out (`requests.ts`). A device signed out from another one is closed at once with
 * 4001, whatever it is doing. How a hello's keys are checked, bound to the device's row and handed
 * over, and how a device holds one live socket: `hello.ts`.
 */
export class SyncConnection {
  readonly #socket: SocketLike
  readonly #onError: (error: DataError) => void
  readonly #renewals: HelloRenewals
  readonly #subscriptions: RegionSubscriptions
  readonly #seen: DeviceSeen
  readonly #changes: RegionChanges
  readonly #requests: DeviceRequests
  readonly #hello: ConnectionHello
  #state: ConnectionState
  /** Settles once every message so far has been handled. */
  #queue: Promise<void> = Promise.resolve()
  /** Takes the connection out of the registry; nothing to take until the keys are accepted. */
  #unregister: () => void = () => {}

  constructor(socket: SocketLike, deps: SyncConnectionDeps) {
    this.#socket = socket
    this.#onError = deps.onError ?? ((error) => deps.log.error({ code: error.code }, error.message))
    this.#renewals = new HelloRenewals(deps)
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
    this.#hello = new ConnectionHello(deps, {
      host,
      listener: this,
      registered: (unregister) => {
        this.#unregister = unregister
      },
      seen: this.#seen,
      pairs: this.#renewals,
      changes: this.#changes,
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
      await this.#hello.say(message)

      return
    }

    if (state.kind === 'ready') {
      this.#seen.talked(state.device)
      await this.#requests.serve(state.device, message)
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
