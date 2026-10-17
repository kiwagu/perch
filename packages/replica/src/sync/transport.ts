import type { Clock } from '../clock'
import {
  CLOSE,
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '../protocol'

export type ChannelState = 'up' | 'down'

/**
 * Why a channel ended for good: the gateway refused the keys, signed the device out, or
 * refused the protocol this device speaks (an application older than the gateway).
 */
export type EndReason = 'unauthorized' | 'signed-out' | 'protocol'

export interface DeviceCredentials {
  readonly access: string
  readonly refresh?: string
}

/** The channel between a device and the gateway that the sync engine talks through. */
export interface SyncTransport {
  start(): void
  stop(): void
  /**
   * Gives up on the current connection, which stopped answering, and connects again after the
   * first delay of the backoff; nothing happens unless a connection is open or opening.
   */
  reconnect(): void
  /** Sends when the channel is up and the gateway has welcomed the device; false otherwise. */
  send(message: ClientMessage): boolean
  onMessage(listener: (message: ServerMessage) => void): () => void
  onChannel(listener: (state: ChannelState) => void): () => void
  /** Hears that the channel ended for good; it is told before the channel goes down. */
  onEnded(listener: (reason: EndReason) => void): () => void
}

/** The part of a WebSocket the transport uses. */
export type SocketLike = Pick<WebSocket, 'addEventListener' | 'send' | 'close'>

export interface WebSocketTransportOptions {
  readonly url: string
  readonly credentials: () => DeviceCredentials | undefined
  readonly onTokens: (tokens: { readonly access: string; readonly refresh: string }) => void
  /** The gateway refused the keys or the protocol, or signed the device out: no reconnect follows. */
  readonly onEnded: (reason: EndReason) => void
  readonly clock: Clock
  /** Opens a socket; `new WebSocket(url)` by default. */
  readonly socket?: (url: string) => SocketLike
}

/** How long the transport waits before each reconnect in a row; the last delay repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

/** How long an open socket waits for the gateway's welcome before it is given up. */
export const WELCOME_TIMEOUT_MS = 10_000

/**
 * The close code of an orderly close (RFC 6455), also of a socket the device gives up on: a
 * browser closes with 1000 or 3000–4999 only, and 4000 already means a sign-out here.
 */
const NORMAL_CLOSE = 1000

const NO_TIMER = (): void => {}

/**
 * Close codes after which the gateway will not take the device back, and what they mean. Any
 * other close, a hello the gateway stopped waiting for (4408) included, is followed by a reconnect.
 */
const ENDINGS: ReadonlyMap<number, EndReason> = new Map([
  [CLOSE.unauthorized, 'unauthorized'],
  [CLOSE.protocol, 'protocol'],
  [CLOSE.signedOut, 'signed-out'],
])

type State =
  /** Not started, or stopped: no socket and no reconnect. */
  | { readonly kind: 'idle' }
  /** A socket is open or opening; the channel is up once the gateway welcomed the device. */
  | { readonly kind: 'connected'; readonly socket: SocketLike; readonly up: boolean }
  /** Waiting to connect again. */
  | { readonly kind: 'waiting'; readonly cancel: () => void }
  /** The gateway refused the keys or the protocol, or signed the device out. */
  | { readonly kind: 'ended' }

/**
 * The device's WebSocket to the gateway. On open it says hello with the stored keys; the
 * channel is up once the gateway welcomes it, and only then does it send. A socket that
 * closes, or is not welcomed within 10 seconds, is opened again after a growing delay, which
 * starts over at the next welcome or when the engine gives a connection up (`reconnect`). A
 * close that refuses the keys or the protocol, or signs the device out, ends the channel for
 * good. Text the protocol refuses closes the socket as a breach and connects again.
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

  constructor(options: WebSocketTransportOptions) {
    this.#options = options
  }

  start(): void {
    if (this.#state.kind === 'idle') {
      this.#connect()
    }
  }

  stop(): void {
    const state = this.#state

    if (state.kind === 'ended') {
      return
    }

    this.#endWelcomeWait()
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

    if (state.kind !== 'connected') {
      return
    }

    const wasUp = state.up

    state.socket.close(NORMAL_CLOSE)
    this.#attempt = 0
    this.#reconnect()

    if (wasUp) {
      this.#emitChannel('down')
    }
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
        access: keys.access,
        ...(keys.refresh === undefined ? {} : { refresh: keys.refresh }),
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

    if (message.type === 'tokens') {
      this.#options.onTokens({ access: message.access, refresh: message.refresh })
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
    const ending = ENDINGS.get(code)

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
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 0

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

  #end(reason: EndReason): void {
    this.#endWelcomeWait()
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
