/**
 * A simulated device for the gateway load test: the event-driven sibling of the smoke test's
 * device. It opens the sync socket, says hello, resolves with the welcome and hands every
 * later server message to the handler of its type, stamped with the time it arrived.
 */

import {
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '@workspace/replica/protocol'

export type Received<T extends ServerMessage['type']> = Extract<ServerMessage, { readonly type: T }>

/** What a device does with the messages that follow its welcome. */
export interface DeviceHandlers {
  /** `at` is `performance.now()` when the message arrived. */
  readonly onUpdates: (message: Received<'updates'>, at: number) => void
  readonly onAck: (message: Received<'ack'>, at: number) => void
  readonly onCompaction: (message: Received<'compaction'>) => void
  readonly onError: (message: Received<'error'>) => void
  readonly onClose: (code: number) => void
}

export class LoadDevice {
  readonly #socket: WebSocket

  private constructor(socket: WebSocket) {
    this.#socket = socket
  }

  /** Opens the socket, says hello and resolves with the welcome. */
  static async open(
    url: string,
    tokens: { readonly access: string; readonly refresh: string },
    handlers: DeviceHandlers,
  ): Promise<{ device: LoadDevice; welcome: Received<'welcome'> }> {
    const socket = new WebSocket(url)
    const device = new LoadDevice(socket)
    const welcome = await new Promise<Received<'welcome'>>((resolve, reject) => {
      let welcomed = false

      socket.addEventListener('error', () => reject(new Error(`could not open ${url}`)))
      socket.addEventListener('close', (event) => {
        if (welcomed) handlers.onClose(event.code)
        else reject(new Error(`${url} closed with ${event.code} before it welcomed`))
      })
      socket.addEventListener('message', (event) => {
        const at = performance.now()
        const data: unknown = event.data

        if (typeof data !== 'string') {
          reject(new Error('the server sent a binary message'))

          return
        }

        decodeMessage(serverMessage, data).match(
          (message) => {
            if (!welcomed) {
              if (message.type !== 'welcome') {
                reject(new Error(`expected welcome, received ${message.type}`))

                return
              }

              welcomed = true
              resolve(message)

              return
            }

            LoadDevice.#dispatch(message, at, handlers)
          },
          (error) => reject(new Error(`the protocol refuses a server message: ${error.message}`)),
        )
      })
      socket.addEventListener('open', () =>
        device.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...tokens }),
      )
    })

    return { device, welcome }
  }

  static #dispatch(message: ServerMessage, at: number, handlers: DeviceHandlers): void {
    switch (message.type) {
      case 'updates':
        handlers.onUpdates(message, at)
        break
      case 'ack':
        handlers.onAck(message, at)
        break
      case 'compaction':
        handlers.onCompaction(message)
        break
      case 'error':
        handlers.onError(message)
        break
      default:
        // memberships, tokens, heads, reject and the rest do not matter to the load.
        break
    }
  }

  send(message: ClientMessage): void {
    this.#socket.send(encodeMessage(clientMessage, message))
  }

  /** Subscribes to `region` from nothing: the server answers with its snapshot. */
  subscribe(region: string): void {
    this.send({ type: 'subscribe', region, vv: null })
  }

  /** Pushes one update, as batch `batch`, into `region`. */
  push(region: string, batch: number, update: Uint8Array<ArrayBuffer>): void {
    this.send({ type: 'push', region, batch, updates: [update] })
  }

  /** Proposes `snapshot` as the compaction of `region` up to head `covers`. */
  compact(region: string, covers: number, snapshot: Uint8Array<ArrayBuffer>): void {
    this.send({ type: 'compact', region, covers, snapshot })
  }

  close(): void {
    this.#socket.close(1000, 'load done')
  }
}
