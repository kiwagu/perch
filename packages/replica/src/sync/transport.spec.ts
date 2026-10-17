import { describe, expect, it } from 'vitest'

import {
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '../protocol'
import { manualClock } from '../testing/manual-clock'

import { type DeviceCredentials, RECONNECT_DELAYS_MS, WebSocketTransport } from './transport'

/** A socket the test opens, feeds and closes by hand; it keeps what the transport sent. */
class FakeSocket extends EventTarget {
  readonly sent: ClientMessage[] = []
  closedWith: number | undefined

  constructor(readonly url: string) {
    super()
  }

  send(text: string): void {
    this.sent.push(decodeMessage(clientMessage, text)._unsafeUnwrap())
  }

  close(code?: number): void {
    this.closedWith = code
  }

  open(): void {
    this.dispatchEvent(new Event('open'))
  }

  receive(message: ServerMessage): void {
    this.receiveText(encodeMessage(serverMessage, message))
  }

  receiveText(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  drop(code: number): void {
    this.dispatchEvent(new CloseEvent('close', { code }))
  }
}

const keys: DeviceCredentials = { access: 'access-key', refresh: 'refresh-key' }

const welcome: ServerMessage = { type: 'welcome', identity: 'idn_a', regions: [], time: 0 }

const probe: ClientMessage = { type: 'probe', regions: ['identity:idn_a'] }

/** A transport over fake sockets with a manual clock; `events` lists channel changes and endings in order. */
function harness(credentials: () => DeviceCredentials | undefined = () => keys) {
  const clock = manualClock()
  const sockets: FakeSocket[] = []
  const events: string[] = []
  const received: ServerMessage[] = []
  const tokens: Array<{ readonly access: string; readonly refresh: string }> = []
  const transport = new WebSocketTransport({
    url: 'wss://gateway.example.test/sync',
    credentials,
    onTokens: (pair) => tokens.push(pair),
    onEnded: (reason) => events.push(`ended: ${reason}`),
    clock,
    socket: (url) => {
      const socket = new FakeSocket(url)

      sockets.push(socket)

      return socket
    },
  })

  transport.onChannel((state) => events.push(state))
  transport.onMessage((message) => received.push(message))

  const socket = (): FakeSocket => {
    const last = sockets.at(-1)

    if (!last) {
      throw new Error('no socket was opened')
    }

    return last
  }

  /** Starts the transport and lets the gateway welcome it. */
  const connect = (): FakeSocket => {
    transport.start()
    socket().open()
    socket().receive(welcome)

    return socket()
  }

  return { clock, sockets, events, received, tokens, transport, socket, connect }
}

describe('WebSocket transport', () => {
  it('says hello with the stored keys when the socket opens', () => {
    const { transport, socket } = harness()

    transport.start()

    expect(socket().url).toBe('wss://gateway.example.test/sync')
    expect(socket().sent).toEqual([])

    socket().open()

    expect(socket().sent).toEqual([
      { type: 'hello', protocol: PROTOCOL_VERSION, access: 'access-key', refresh: 'refresh-key' },
    ])
  })

  it('reports up only after welcome', () => {
    const { transport, socket, events, received } = harness()

    transport.start()
    socket().open()

    expect(events).toEqual([])
    expect(transport.send(probe)).toBe(false)

    socket().receive(welcome)

    expect(events).toEqual(['up'])
    expect(received).toEqual([welcome])
    expect(transport.send(probe)).toBe(true)
    expect(socket().sent.at(-1)).toEqual(probe)
  })

  it('reconnects after 1, 2, 4 … 30 seconds', async () => {
    const { clock, sockets, transport, socket, events } = harness()

    expect(RECONNECT_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000])

    transport.start()

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const opened = sockets.length

      socket().drop(1006)
      await clock.advance(delay - 1)

      expect(sockets.length).toBe(opened)

      await clock.advance(1)

      expect(sockets.length).toBe(opened + 1)
    }

    // A welcome starts the delays over.
    socket().open()
    socket().receive(welcome)
    socket().drop(1006)
    await clock.advance(1_000)

    expect(sockets.length).toBe(9)
    expect(events).toEqual(['up', 'down'])
  })

  it('hands renewed keys to onTokens', () => {
    const { connect, tokens } = harness()

    connect().receive({ type: 'tokens', access: 'access-key-2', refresh: 'refresh-key-2' })

    expect(tokens).toEqual([{ access: 'access-key-2', refresh: 'refresh-key-2' }])
  })

  it('stops on 4401 and reports unauthorized', async () => {
    const { clock, sockets, connect, transport, events } = harness()
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4401)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: unauthorized', 'down'])
    expect(ended).toEqual(['unauthorized'])
    expect(sockets.length).toBe(1)
  })

  it('stops on 4400 from the gateway and reports unauthorized', async () => {
    const { clock, sockets, connect, events } = harness()

    connect().drop(4400)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: unauthorized', 'down'])
    expect(sockets.length).toBe(1)
  })

  it('stops on 4000 and reports signed-out', async () => {
    const { clock, sockets, connect, events } = harness()

    connect().drop(4000)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: signed-out', 'down'])
    expect(sockets.length).toBe(1)
  })

  it('ends as unauthorized when it holds no keys to say hello with', async () => {
    const { clock, sockets, transport, socket, events } = harness(() => undefined)

    transport.start()
    socket().open()
    await clock.advance(60_000)

    expect(socket().sent).toEqual([])
    expect(socket().closedWith).toBe(1000)
    expect(events).toEqual(['ended: unauthorized'])
    expect(sockets.length).toBe(1)
  })

  it('closes on a message the protocol refuses and connects again', async () => {
    const { clock, sockets, connect, events } = harness()
    const socket = connect()

    socket.receiveText('{"type":"welcome"}')

    expect(socket.closedWith).toBe(4400)
    expect(events).toEqual(['up', 'down'])

    // The close the socket reports afterwards changes nothing.
    socket.drop(4400)
    await clock.advance(1_000)

    expect(events).toEqual(['up', 'down'])
    expect(sockets.length).toBe(2)
  })

  it('send returns false while down', async () => {
    const { clock, transport, socket, connect } = harness()

    expect(transport.send(probe)).toBe(false)

    transport.start()

    expect(transport.send(probe)).toBe(false)

    connect().drop(1006)

    expect(transport.send(probe)).toBe(false)

    await clock.advance(1_000)
    socket().open()

    expect(transport.send(probe)).toBe(false)
  })

  it('closes the socket on stop and connects no more', async () => {
    const { clock, sockets, connect, transport, events } = harness()
    const socket = connect()

    transport.stop()
    socket.drop(1000)
    await clock.advance(60_000)

    expect(socket.closedWith).toBe(1000)
    expect(events).toEqual(['up', 'down'])
    expect(sockets.length).toBe(1)
    expect(transport.send(probe)).toBe(false)
  })
})
