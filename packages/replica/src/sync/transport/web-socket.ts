import type { PlatformRole } from '@workspace/kernel'

import type { Clock } from '../../clock'
import {
  CLOSE,
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '../../protocol'

import { endingOf } from './endings'
import type { ChannelState, DeviceCredentials, EndReason, SyncTransport } from './port'
import { reconnectDelay } from './reconnect-delay'

/** The part of a WebSocket the transport uses. */
export type SocketLike = Pick<WebSocket, 'addEventListener' | 'send' | 'close'>

/**
 * The device's network as the platform tells it: whether it says the device has one now, and
 * its changes (a browser's `online` and `offline` events); `onOnlineChange` returns what stops
 * hearing them.
 */
export interface DeviceNetwork {
  readonly online: () => boolean
  readonly onOnlineChange: (listener: () => void) => () => void
}

export interface WebSocketTransportOptions {
  readonly url: string
  readonly credentials: () => DeviceCredentials | undefined
  /** The device's own id, named in every hello. */
  readonly device: string
  /** Hears the identity's memberships: those it was welcomed with, then each change of them. */
  readonly onMemberships?: (memberships: readonly Membership[]) => void
  /** Hears the account's platform roles each welcome carries, after its memberships. */
  readonly onRoles?: (roles: readonly PlatformRole[]) => void
  /**
   * The gateway refused the token or the protocol, or signed the device out, at its own request,
   * from another device or for its account's sake: no reconnect follows.
   */
  readonly onEnded: (reason: EndReason) => void
  readonly clock: Clock
  /** Opens a socket; `new WebSocket(url)` by default. */
  readonly socket?: (url: string) => SocketLike
  /**
   * The device's network, heard while the transport is started: once it is back, a reconnect
   * waiting for its delay connects at once, and the delays start over. Without it, only the
   * delays bring the channel back.
   */
  readonly network?: DeviceNetwork
}

/** How long an open socket waits for the gateway's welcome before it is given up. */
export const WELCOME_TIMEOUT_MS = 10_000

/**
 * The close code of an orderly close (RFC 6455), also of a socket the device gives up on: a
 * browser closes with 1000 or 3000–4999 only, and 4000 already means a sign-out here.
 */
const NORMAL_CLOSE = 1000

const NO_TIMER = (): void => {}

/** What stops hearing the device's network while the transport hears none. */
const NOT_HEARING = (): void => {}

type State =
  /** Not started, or stopped: no socket and no reconnect. */
  | { readonly kind: 'idle' }
  /** A socket is open or opening; the channel is up once the gateway welcomed the device. */
  | { readonly kind: 'connected'; readonly socket: SocketLike; readonly up: boolean }
  /** Waiting to connect again. */
  | { readonly kind: 'waiting'; readonly cancel: () => void }
  /** The gateway refused the token or the protocol, or signed the device out. */
  | { readonly kind: 'ended' }

/**
 * The device's WebSocket to the gateway. On open it says hello with the stored token and the
 * device's id; the channel is up once the gateway welcomes it, and only then does it send.
 * The memberships of the welcome and of every later change go to `onMemberships`, before the
 * listeners of messages hear the message. A socket that closes, or is not welcomed within 10
 * seconds, is opened again after a growing delay, which starts over at the next welcome, when
 * the engine gives a welcomed connection up (`reconnect`) or when the device's network comes
 * back (`network`), which also connects a pending reconnect at once. A close that
 * refuses the token or the protocol, or signs the device out (at its own request or from another
 * device), ends the channel for good. Text the protocol refuses closes the socket as a breach
 * and connects again.
 */
export class WebSocketTransport implements SyncTransport {
  readonly #options: WebSocketTransportOptions
  readonly #messageListeners = new Set<(message: ServerMessage) => void>()
  readonly #channelListeners = new Set<(state: ChannelState) => void>()
  readonly #endedListeners = new Set<(reason: EndReason) => void>()
  #state: State = { kind: 'idle' }
  /** How many reconnects in a row have failed to reach a welcome. */
  #attempt = 0
  /** Gives up on the open socket when the welcome does not come in time. */
  #cancelWelcome = NO_TIMER
  /** Stops hearing the device's network, heard from the start until a stop or an ending. */
  #stopHearingNetwork = NOT_HEARING

  constructor(options: WebSocketTransportOptions) {
    this.#options = options
  }

  start(): void {
    if (this.#state.kind === 'idle') {
      this.#connect()
      this.#hearNetwork()
    }
  }

  stop(): void {
    const state = this.#state

    if (state.kind === 'ended') {
      return
    }

    this.#endWelcomeWait()
    this.#stopHearing()
    this.#state = { kind: 'idle' }

    if (state.kind === 'waiting') {
      state.cancel()
    }

    if (state.kind === 'connected') {
      state.socket.close(NORMAL_CLOSE)

      if (state.up) {
        this.#emitChannel('down')
      }
    }
  }

  reconnect(): void {
    const state = this.#state

    // A socket not welcomed yet is left alone: its hello is out, and closing the socket now would
    // only send another hello with the same token. The engine's answer timeouts never land here: they are cancelled when the
    // channel goes down, so they only fire on a welcomed connection. A socket left alone is given
    // up as any other: by its close, or by the welcome wait once it opened.
    if (state.kind !== 'connected' || !state.up) {
      return
    }

    state.socket.close(NORMAL_CLOSE)
    this.#attempt = 0
    this.#reconnect()
    this.#emitChannel('down')
  }

  send(message: ClientMessage): boolean {
    const state = this.#state

    if (state.kind !== 'connected' || !state.up) {
      return false
    }

    state.socket.send(encodeMessage(clientMessage, message))

    return true
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.#messageListeners.add(listener)

    return () => this.#messageListeners.delete(listener)
  }

  onChannel(listener: (state: ChannelState) => void): () => void {
    this.#channelListeners.add(listener)

    return () => this.#channelListeners.delete(listener)
  }

  onEnded(listener: (reason: EndReason) => void): () => void {
    this.#endedListeners.add(listener)

    return () => this.#endedListeners.delete(listener)
  }

  #connect(): void {
    const socket = this.#options.socket?.(this.#options.url) ?? new WebSocket(this.#options.url)

    this.#state = { kind: 'connected', socket, up: false }
    // Events of a socket the transport has left behind change nothing.
    socket.addEventListener('open', () => {
      if (this.#current(socket)) {
        this.#hello(socket)
      }
    })
    socket.addEventListener('message', (event) => {
      if (this.#current(socket)) {
        this.#receive(socket, event.data)
      }
    })
    socket.addEventListener('close', (event) => {
      if (this.#current(socket)) {
        this.#closed(event.code)
      }
    })
  }

  #current(socket: SocketLike): boolean {
    return this.#state.kind === 'connected' && this.#state.socket === socket
  }

  #hello(socket: SocketLike): void {
    const keys = this.#options.credentials()

    if (!keys) {
      socket.close(NORMAL_CLOSE)
      this.#end('unauthorized')

      return
    }

    // A gateway that takes the socket but never welcomes it is as gone as a closed one.
    this.#cancelWelcome = this.#options.clock.schedule(WELCOME_TIMEOUT_MS, () => {
      this.#cancelWelcome = NO_TIMER

      if (this.#current(socket) && !this.#isUp()) {
        socket.close(NORMAL_CLOSE)
        this.#reconnect()
      }
    })
    socket.send(
      encodeMessage(clientMessage, {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        token: keys.token,
        device: this.#options.device,
      }),
    )
  }

  #receive(socket: SocketLike, data: unknown): void {
    // The gateway sends text only: anything else breaks the protocol like text it refuses.
    const message =
      typeof data === 'string' ? decodeMessage(serverMessage, data).unwrapOr(undefined) : undefined

    if (!message) {
      this.#breach(socket)

      return
    }

    if (message.type === 'welcome') {
      this.#attempt = 0
      this.#endWelcomeWait()
      this.#state = { kind: 'connected', socket, up: true }
    }

    if (message.type === 'welcome' || message.type === 'memberships') {
      this.#options.onMemberships?.(message.memberships)
    }

    if (message.type === 'welcome') {
      this.#options.onRoles?.(message.roles)
    }

    for (const listener of this.#messageListeners) {
      listener(message)
    }

    if (message.type === 'welcome') {
      this.#emitChannel('up')
    }
  }

  /**
   * The socket closed: a close that ends the channel is told before the channel goes down, any
   * other is followed by a reconnect.
   */
  #closed(code: number): void {
    const wasUp = this.#isUp()
    const ending = endingOf(code)

    if (ending) {
      this.#end(ending)
    } else {
      this.#reconnect()
    }

    if (wasUp) {
      this.#emitChannel('down')
    }
  }

  /** Closes a socket that broke the protocol and connects again; its own close event is ignored. */
  #breach(socket: SocketLike): void {
    const wasUp = this.#isUp()

    socket.close(CLOSE.protocol)
    this.#reconnect()

    if (wasUp) {
      this.#emitChannel('down')
    }
  }

  #reconnect(): void {
    const delay = reconnectDelay(this.#attempt)

    this.#endWelcomeWait()

    this.#attempt += 1
    this.#state = {
      kind: 'waiting',
      cancel: this.#options.clock.schedule(delay, () => this.#connect()),
    }
  }

  #isUp(): boolean {
    return this.#state.kind === 'connected' && this.#state.up
  }

  #endWelcomeWait(): void {
    this.#cancelWelcome()
    this.#cancelWelcome = NO_TIMER
  }

  #hearNetwork(): void {
    const network = this.#options.network

    if (network) {
      this.#stopHearingNetwork = network.onOnlineChange(() => {
        if (network.online()) {
          this.#networkBack()
        }
      })
    }
  }

  #stopHearing(): void {
    this.#stopHearingNetwork()
    this.#stopHearingNetwork = NOT_HEARING
  }

  /**
   * The device's network came back: the delays start over, and a reconnect waiting for its delay
   * connects at once. A socket open or still opening is left to its welcome or its close, which
   * then waits the first delay.
   */
  #networkBack(): void {
    const state = this.#state

    this.#attempt = 0

    if (state.kind === 'waiting') {
      state.cancel()
      this.#connect()
    }
  }

  #end(reason: EndReason): void {
    this.#endWelcomeWait()
    this.#stopHearing()
    this.#state = { kind: 'ended' }
    this.#options.onEnded(reason)

    for (const listener of this.#endedListeners) {
      listener(reason)
    }
  }

  #emitChannel(state: ChannelState): void {
    for (const listener of this.#channelListeners) {
      listener(state)
    }
  }
}
