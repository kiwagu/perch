import type { Result } from 'neverthrow'
import { match, P } from 'ts-pattern'

import { type AuthTokens, type AuthUser, type DataError, dataError } from '@workspace/data'
import type { Logger } from '@workspace/logger'
import type { Clock, RegionRef } from '@workspace/replica'
import {
  CLOSE,
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'
import type { RegionHub, Subscriber } from '@workspace/replica/server'

import type { IdentitySessions } from '../auth/identity-sessions'

/** The end of a device's WebSocket the connection writes to. */
export interface SocketLike {
  send(text: string): void
  close(code: number, reason: string): void
}

export interface SyncConnectionDeps {
  readonly sessions: Pick<IdentitySessions, 'authenticate' | 'revoke'>
  readonly hub: Pick<RegionHub, 'subscribe' | 'unsubscribe' | 'pull' | 'push' | 'heads' | 'compact'>
  readonly clock: Clock
  /** Hears sign-outs and failures; no line carries a token, a key or a grant id. */
  readonly log: Logger
  /** How long a device may stay silent before its hello; 10 s by default. */
  readonly helloTimeoutMs?: number
  /**
   * Hears each failure the connection did not expect; the device was answered with an
   * internal error and its socket closed. Logged at error level by default.
   */
  readonly onError?: (error: DataError) => void
}

/** A device whose keys were accepted. */
interface Device {
  readonly identity: AuthUser
  /** The keys it holds now: renewed at hello, or as it came with them. */
  readonly tokens: AuthTokens
  /** The identity's private region, the only region the device may name. */
  readonly region: RegionRef
}

type State =
  | { readonly kind: 'waiting'; readonly cancelHello: () => void }
  | { readonly kind: 'ready'; readonly device: Device }
  | { readonly kind: 'closed' }

/** The close code of a server that failed (RFC 6455). */
const SERVER_ERROR = 1011

/** Close reasons are fixed texts: a reason never repeats what the device sent. */
const REASON = {
  malformed: 'the message does not follow the protocol',
  helloFirst: 'the first message must be hello',
  helloTwice: 'hello was already said',
  silent: 'no hello in time',
  refused: 'the keys were not accepted',
  forbidden: 'the region is not open to this device',
  signedOut: 'signed out',
  revokeFailed: 'revoke failed',
  failed: 'the gateway failed to handle the message',
} as const

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
 * the hello time; once they are accepted it is welcomed with its identity's private region
 * and may subscribe, pull, push, probe and compact in that region only, each handed to the
 * region hub, which answers the device itself. Messages are handled one at a time, in the
 * order they came. Text the protocol refuses closes the socket; so does a region of
 * somebody else and a sign-out, which also revokes the device's refresh grant: the sign-out
 * close (4000) means the grant is revoked, and a grant that cannot be revoked closes the
 * socket as a failed server (1011) instead.
 */
export class SyncConnection {
  readonly #socket: SocketLike
  readonly #sessions: SyncConnectionDeps['sessions']
  readonly #hub: SyncConnectionDeps['hub']
  readonly #clock: Clock
  readonly #log: Logger
  readonly #onError: (error: DataError) => void
  readonly #subscriber: Subscriber
  /** The regions the device subscribed to, to leave when the socket closes. */
  readonly #subscribed = new Set<string>()
  #state: State
  /** Settles once every message received so far has been handled. */
  #queue: Promise<void> = Promise.resolve()

  constructor(socket: SocketLike, deps: SyncConnectionDeps) {
    this.#socket = socket
    this.#sessions = deps.sessions
    this.#hub = deps.hub
    this.#clock = deps.clock
    this.#log = deps.log
    this.#onError = deps.onError ?? ((error) => deps.log.error({ code: error.code }, error.message))
    this.#subscriber = {
      id: crypto.randomUUID(),
      send: (message) => this.#send(message),
    }
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
    const handled = this.#queue.then(() => this.#handle(text))

    this.#queue = handled

    return handled
  }

  /** The socket closed: leaves every region and ignores whatever comes later. */
  closed(): void {
    if (this.#state.kind === 'waiting') {
      this.#state.cancelHello()
    }

    this.#state = { kind: 'closed' }

    for (const region of this.#subscribed) {
      this.#hub.unsubscribe(region, this.#subscriber.id)
    }

    this.#subscribed.clear()
  }

  async #handle(text: string): Promise<void> {
    if (this.#state.kind === 'closed') {
      return
    }

    try {
      await this.#dispatch(text)
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
      await this.#hello(message.access, message.refresh)

      return
    }

    if (state.kind === 'ready') {
      await this.#serve(state.device, message)
    }
  }

  async #hello(access: string, refresh: string | undefined): Promise<void> {
    const authenticated = await this.#sessions.authenticate(
      refresh === undefined ? { access } : { access, refresh },
    )

    if (this.#isClosed()) {
      // The device's refresh key is spent and the pair that replaces it cannot reach it now:
      // it will be refused at its next hello. Counted here, without the keys.
      if (authenticated.isOk() && authenticated.value.renewed) {
        this.#log.warn({ identity: authenticated.value.identity.id }, 'renewed pair not delivered')
      }

      return
    }

    if (authenticated.isErr()) {
      this.#close(CLOSE.unauthorized, REASON.refused)

      return
    }

    const { identity, tokens, renewed } = authenticated.value
    const device: Device = {
      identity,
      tokens,
      region: { kind: 'private', id: `identity:${identity.id}` },
    }

    // The renewed pair goes out first, before anything else is awaited: the key the device
    // holds is spent already.
    if (renewed) {
      this.#send({ type: 'tokens', access: tokens.access, refresh: tokens.refresh })
    }

    const heads = await this.#hub.heads([device.region.id])

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
      time: this.#clock.now(),
    })
  }

  async #serve(device: Device, message: ClientMessage): Promise<void> {
    const own = device.region.id

    if (regionsOf(message).some((region) => region !== own)) {
      this.#send({ type: 'error', code: 'forbidden-region', message: REASON.forbidden })
      this.#close(CLOSE.forbidden, REASON.forbidden)

      return
    }

    const subscriber = this.#subscriber

    await match(message)
      .with({ type: 'hello' }, async () => this.#close(CLOSE.protocol, REASON.helloTwice))
      .with({ type: 'sign-out' }, () => this.#signOut(device))
      .with({ type: 'subscribe' }, async ({ vv }) => {
        this.#subscribed.add(own)
        this.#settle(await this.#hub.subscribe(device.region, own, subscriber, vv))
      })
      .with({ type: 'pull' }, async ({ vv }) => {
        this.#settle(await this.#hub.pull(own, subscriber, vv))
      })
      .with({ type: 'push' }, async ({ batch, updates }) => {
        this.#settle(await this.#hub.push(own, subscriber, batch, updates))
      })
      .with({ type: 'compact' }, async ({ covers, snapshot }) => {
        this.#settle(await this.#hub.compact(own, subscriber, covers, snapshot))
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
   * Leaves the device's regions, revokes its refresh grant and closes as signed out. A device
   * that came with an access token only holds no grant. A revoke that fails is tried once
   * more; a grant that still cannot be revoked is logged, and the socket closes as a failed
   * server: the device must not take the sign-out close for a revoked grant.
   */
  async #signOut(device: Device): Promise<void> {
    for (const region of this.#subscribed) {
      this.#hub.unsubscribe(region, this.#subscriber.id)
    }

    this.#subscribed.clear()

    const { access, refresh } = device.tokens

    if (refresh === undefined) {
      this.#log.info(
        { identity: device.identity.id },
        'device signed out with an access token only: no grant to revoke',
      )
    } else {
      const tokens = { access, refresh }
      const revoked = await this.#sessions
        .revoke(tokens)
        .orElse(() => this.#sessions.revoke(tokens))

      if (revoked.isErr()) {
        this.#log.warn(
          { identity: device.identity.id, code: revoked.error.code },
          'the refresh grant of a device that signed out could not be revoked',
        )
        this.#close(SERVER_ERROR, REASON.revokeFailed)

        return
      }
    }

    this.#close(CLOSE.signedOut, REASON.signedOut)
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
