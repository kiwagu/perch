/**
 * The network between a page and the gateway's sync socket, under the test's control.
 * Playwright's offline mode (`context.setOffline`) fails new requests but keeps a WebSocket
 * that is already open alive, so a page would stay in sync while "offline". The page's sync
 * sockets are therefore routed through the test: going offline also drops the socket the page
 * holds and refuses new ones until the network is back. The test can also stand for a gateway
 * that no longer takes the page's sync protocol.
 */

import type { Page, WebSocketRoute } from '@playwright/test'

/** The sync socket's address on the front: `wss://<front>/backend/sync`. */
const SYNC_SOCKET = /\/backend\/sync$/

/**
 * What the page hears when the network goes: the abnormal close a dropped connection gives
 * (RFC 6455 code 1006), after which the app connects again.
 */
const DROPPED = { code: 1006, reason: 'offline' } as const

/** What the page hears from a gateway that no longer takes its sync protocol: its close 4400. */
const PROTOCOL_REFUSED = { code: 4400, reason: 'protocol' } as const

/** A close code a browser may send itself (RFC 6455); a WebSocket refuses any other. */
const sendable = (code: number | undefined): code is number =>
  code === 1000 || (code !== undefined && code >= 3000 && code <= 4999)

/**
 * How long a page may take to connect again once `goOnline` brought its browser back: the app
 * tries at once when the browser says it is online instead of waiting out its reconnect delay
 * (up to 30 seconds), so this bounds a hello and what its answer leads to on a busy host.
 */
export const BACK_ONLINE_MS = 10_000

export class SyncNetwork {
  readonly #page: Page
  #online = true
  #refusing = false
  #dropping = false
  /** The page side of the socket the page holds now. */
  #socket: WebSocketRoute | undefined

  private constructor(page: Page) {
    this.#page = page
  }

  /** Routes the page's sync sockets; call it before the page opens the app. */
  static async attach(page: Page): Promise<SyncNetwork> {
    const network = new SyncNetwork(page)

    await page.routeWebSocket(SYNC_SOCKET, (socket) => network.#connect(socket))

    return network
  }

  /** Takes the page's browser offline and drops the sync socket the page holds. */
  async goOffline(): Promise<void> {
    this.#online = false
    await this.#page.context().setOffline(true)
    await this.#socket?.close(DROPPED)
    this.#socket = undefined
  }

  /** Brings the page's browser back online; the app's next attempt connects again. */
  async goOnline(): Promise<void> {
    this.#online = true
    await this.#page.context().setOffline(false)
  }

  /**
   * The connection to the gateway breaks while the browser keeps its network: the socket the
   * page holds drops, and every new one too until `restoreChannel`.
   */
  async dropChannel(): Promise<void> {
    this.#dropping = true
    await this.#socket?.close(DROPPED)
    this.#socket = undefined
  }

  /** The gateway is reached again: the app's next attempt connects. */
  restoreChannel(): void {
    this.#dropping = false
  }

  /**
   * The gateway no longer takes the page's sync protocol: the socket the page holds ends with
   * the gateway's close for it, and so does every new one until `acceptProtocol`.
   */
  async refuseProtocol(): Promise<void> {
    this.#refusing = true
    await this.#socket?.close(PROTOCOL_REFUSED)
    this.#socket = undefined
  }

  /** The gateway takes the page's protocol again, as one serving the build the page now runs. */
  acceptProtocol(): void {
    this.#refusing = false
  }

  async #connect(socket: WebSocketRoute): Promise<void> {
    if (!this.#online || this.#dropping) {
      await socket.close(DROPPED)

      return
    }

    if (this.#refusing) {
      await socket.close(PROTOCOL_REFUSED)

      return
    }

    const server = socket.connectToServer()

    // The page closed its socket, or the test dropped it: the gateway hears an orderly close,
    // with the page's own code when a browser may send it. Closes from the gateway reach the
    // page unchanged.
    socket.onClose((code, reason) => {
      void server.close(sendable(code) ? { code, reason: reason ?? '' } : {})
    })
    this.#socket = socket
  }
}
