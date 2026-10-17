/**
 * A device's end of the gateway's sync WebSocket, as the smoke test drives it: it sends
 * client messages and takes the server's messages strictly in the order they came.
 */

import {
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'

type Received<T extends ServerMessage['type']> = Extract<ServerMessage, { readonly type: T }>

export interface Closed {
  readonly code: number
  readonly reason: string
}

function isOf<T extends ServerMessage['type']>(
  message: ServerMessage,
  type: T,
): message is Received<T> {
  return message.type === type
}

function describe(message: ServerMessage): string {
  return message.type === 'error' ? `error ${message.code} (${message.message})` : message.type
}

export class SmokeDevice {
  readonly #socket: WebSocket
  readonly #inbox: ServerMessage[] = []
  readonly #wakers: Array<() => void> = []
  readonly #opened: Promise<void>
  /** Settles with the close code and reason once the socket closed. */
  readonly closed: Promise<Closed>
  #closedWith: Closed | undefined
  #problem: string | undefined

  private constructor(socket: WebSocket, url: string) {
    this.#socket = socket
    this.#opened = new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error(`could not open ${url}`)))
    })
    this.closed = new Promise((resolve) => {
      socket.addEventListener('close', (event) => {
        this.#closedWith = { code: event.code, reason: event.reason }
        resolve(this.#closedWith)
        this.#wake()
      })
    })
    socket.addEventListener('message', (event) => {
      const data: unknown = event.data

      if (typeof data === 'string') {
        decodeMessage(serverMessage, data).match(
          (message) => this.#inbox.push(message),
          (error) => {
            this.#problem = `the server sent a message the protocol refuses: ${error.message}`
          },
        )
      } else {
        this.#problem = 'the server sent a binary message'
      }

      this.#wake()
    })
  }

  /** Opens a socket to the gateway's sync endpoint. */
  static async open(url: string): Promise<SmokeDevice> {
    const device = new SmokeDevice(new WebSocket(url), url)

    await device.#opened

    return device
  }

  send(message: ClientMessage): void {
    this.#socket.send(encodeMessage(clientMessage, message))
  }

  /** The next message the server sent, which must be of `type`. */
  async next<T extends ServerMessage['type']>(type: T): Promise<Received<T>> {
    for (;;) {
      const message = this.#inbox.shift()

      if (message) {
        if (isOf(message, type)) {
          return message
        }

        throw new Error(`expected ${type}, received ${describe(message)}`)
      }

      if (this.#problem) {
        throw new Error(this.#problem)
      }

      if (this.#closedWith) {
        throw new Error(`expected ${type}, the socket closed with ${this.#closedWith.code}`)
      }

      await new Promise<void>((resolve) => this.#wakers.push(resolve))
    }
  }

  /** Subscribes to `region` from nothing: the server answers with its snapshot. */
  subscribe(region: string): void {
    this.send({ type: 'subscribe', region, vv: null })
  }

  /** Pushes one update, as batch `batch`, into `region`. */
  push(region: string, batch: number, update: Uint8Array<ArrayBuffer>): void {
    this.send({ type: 'push', region, batch, updates: [update] })
  }

  close(): void {
    this.#socket.close(1000, 'smoke done')
  }

  #wake(): void {
    for (const wake of this.#wakers.splice(0)) {
      wake()
    }
  }
}
