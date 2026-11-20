import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ClientMessage,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  PROTOCOL_VERSION,
  type ServerMessage,
  serverMessage,
} from '../../protocol'
import { manualClock } from '../../testing'

import type { DeviceCredentials } from './port'
import { type DeviceNetwork, WebSocketTransport } from './web-socket'

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

const keys: DeviceCredentials = { token: 'session-token' }

const welcome: ServerMessage = {
  type: 'welcome',
  identity: 'idn_a',
  regions: [],
  memberships: [],
  roles: [],
  time: 0,
}

const acme: Membership = { tenant: { id: 'tnt_a', key: 'acme', name: 'Acme' }, role: 'member' }

const probe: ClientMessage = { type: 'probe', regions: ['identity:idn_a'] }

/** A random source that gives `draw` every time, a number in [0, 1) as `Math.random` does. */
const constant = (draw: number) => (): number => draw

/** A random source that gives `draws` one by one, and refuses a draw beyond them. */
function scripted(...draws: number[]): () => number {
  const left = [...draws]

  return () => left.shift() ?? expect.unreachable('a draw beyond the script')
}

/** The random source of a test in which the transport has no delay to draw. */
const noDraw = (): number => expect.unreachable('the transport drew a delay')

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * A transport over fake sockets with a manual clock, drawing its delays from `random`; `events`
 * lists channel changes and endings in order.
 */
function harness(
  random: () => number,
  credentials: () => DeviceCredentials | undefined = () => keys,
  network?: DeviceNetwork,
) {
  const clock = manualClock()
  const sockets: FakeSocket[] = []
  const events: string[] = []
  const received: ServerMessage[] = []
  const memberships: Array<readonly Membership[]> = []
  const transport = new WebSocketTransport({
    url: 'wss://gateway.example.test/sync',
    credentials,
    onMemberships: (list) => memberships.push(list),
    onEnded: (reason) => events.push(`ended: ${reason}`),
    clock,
    device: 'device-1',
    random,
    socket: (url) => {
      const socket = new FakeSocket(url)

      sockets.push(socket)

      return socket
    },
    ...(network ? { network } : {}),
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

  return {
    clock,
    sockets,
    events,
    received,
    memberships,
    transport,
    socket,
    connect,
  }
}

/** The device's network, which the test takes away and brings back; it counts who hears it. */
function fakeNetwork() {
  const listeners = new Set<() => void>()
  let online = true

  const network: DeviceNetwork = {
    online: () => online,
    onOnlineChange: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }

  /** The browser says its network went (`false`) or came back (`true`), as its events do. */
  const change = (now: boolean): void => {
    online = now

    for (const listener of [...listeners]) {
      listener()
    }
  }

  return { network, change, listening: () => listeners.size }
}

describe('WebSocket transport', () => {
  it('says hello with the stored token and the device when the socket opens', () => {
    const { transport, socket } = harness(noDraw)

    transport.start()

    expect(socket().url).toBe('wss://gateway.example.test/sync')
    expect(socket().sent).toEqual([])

    socket().open()

    expect(socket().sent).toEqual([
      {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'session-token',
        device: 'device-1',
      },
    ])
  })

  it('says hello with the current protocol', () => {
    const { transport, socket } = harness(noDraw, () => ({ token: 'other-token' }))

    transport.start()
    socket().open()

    expect(socket().sent).toEqual([
      { type: 'hello', protocol: PROTOCOL_VERSION, token: 'other-token', device: 'device-1' },
    ])
  })

  it('reports up only after welcome', () => {
    const { transport, socket, events, received } = harness(noDraw)

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

  it('reconnects after a draw from 0 up to 1, 2, 4 … 30 seconds: half of each for a draw of 0.5', async () => {
    const { clock, sockets, transport, socket, events } = harness(constant(0.5))

    transport.start()

    for (const delay of [500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
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
    await clock.advance(500)

    expect(sockets.length).toBe(9)
    expect(events).toEqual(['up', 'down'])
  })

  it('reconnects one millisecond under each step for the highest draw, 0.9999999', async () => {
    const { clock, sockets, transport, socket } = harness(constant(0.9999999))

    transport.start()

    for (const delay of [999, 1_999, 3_999, 7_999, 15_999, 29_999, 29_999]) {
      const opened = sockets.length

      socket().drop(1006)
      await clock.advance(delay - 1)

      expect(sockets.length).toBe(opened)

      await clock.advance(1)

      expect(sockets.length).toBe(opened + 1)
    }
  })

  it('reconnects after 0 ms for a draw of 0, through the clock', async () => {
    const { clock, sockets, transport, socket } = harness(constant(0))

    transport.start()
    socket().drop(1006)

    expect(sockets).toHaveLength(1)

    await clock.advance(0)

    expect(sockets).toHaveLength(2)
  })

  it('draws anew from its random source for each reconnect', async () => {
    const { clock, sockets, transport, socket } = harness(scripted(0.25, 0.75, 0.1))

    transport.start()

    // 0.25 of the first step, 0.75 of the second, 0.1 of the third.
    for (const delay of [250, 1_500, 400]) {
      const opened = sockets.length

      socket().drop(1006)
      await clock.advance(delay - 1)

      expect(sockets.length).toBe(opened)

      await clock.advance(1)

      expect(sockets.length).toBe(opened + 1)
    }
  })

  it('draws from Math.random when it is given no random source', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const clock = manualClock()
    const sockets: FakeSocket[] = []
    const transport = new WebSocketTransport({
      url: 'wss://gateway.example.test/sync',
      credentials: () => keys,
      onEnded: () => {},
      clock,
      device: 'device-1',
      socket: (url) => {
        const opened = new FakeSocket(url)

        sockets.push(opened)

        return opened
      },
    })

    transport.start()
    sockets[0]?.drop(1006)
    await clock.advance(499)

    expect(sockets).toHaveLength(1)

    await clock.advance(1)

    expect(sockets).toHaveLength(2)
  })

  it('connects after the network-back draw when the network comes back while a reconnect waits, and starts its delays over', async () => {
    const { network, change } = fakeNetwork()
    // Every delay is half its step, the network-back delay too: 500 ms.
    const { clock, sockets, transport, socket, events } = harness(
      constant(0.5),
      () => keys,
      network,
    )

    transport.start()
    socket().open()
    socket().receive(welcome)
    change(false)

    // Every attempt fails while the network is gone, until the delay has grown to 15 seconds.
    for (const delay of [500, 1_000, 2_000, 4_000, 8_000]) {
      socket().drop(1006)
      await clock.advance(delay)
    }

    socket().drop(1006)
    await clock.advance(10_000)

    expect(sockets).toHaveLength(6)

    change(true)

    // Not at once: the draw, 500 ms, is waited first.
    expect(sockets).toHaveLength(6)

    await clock.advance(499)

    expect(sockets).toHaveLength(6)

    await clock.advance(1)

    expect(sockets).toHaveLength(7)

    // The delays start over: an attempt that fails now waits a draw from the first step.
    socket().drop(1006)
    await clock.advance(499)

    expect(sockets).toHaveLength(7)

    await clock.advance(1)

    expect(sockets).toHaveLength(8)

    // The wait the network cut short opens nothing later.
    socket().open()
    socket().receive(welcome)
    await clock.advance(60_000)

    expect(sockets).toHaveLength(8)
    expect(events).toEqual(['up', 'down', 'up'])
  })

  it('connects after 0 ms, through the clock, when the network-back draw is 0', async () => {
    const { network, change } = fakeNetwork()
    // 0.5 of the first step for the failure, then 0 for the network back.
    const { clock, sockets, transport, socket } = harness(scripted(0.5, 0), () => keys, network)

    transport.start()
    socket().drop(1006)
    change(true)

    expect(sockets).toHaveLength(1)

    await clock.advance(0)

    expect(sockets).toHaveLength(2)
  })

  it('leaves a reconnect due sooner than the network-back draw as it is: one socket, when it was due', async () => {
    const { network, change } = fakeNetwork()
    // The failure draws 0.5 of the first step, 500 ms; the network back draws 500 ms again, from
    // a reconnect due in 300.
    const { clock, sockets, transport, socket } = harness(
      scripted(0.5, 0.5, 0.25),
      () => keys,
      network,
    )

    transport.start()
    socket().drop(1006)
    await clock.advance(200)
    change(true)
    await clock.advance(299)

    expect(sockets).toHaveLength(1)

    await clock.advance(1)

    expect(sockets).toHaveLength(2)

    // No second socket opens when the network-back delay passes.
    await clock.advance(60_000)

    expect(sockets).toHaveLength(2)

    // The delays started over all the same: the next failure draws 0.25 of the first step, 250 ms.
    socket().drop(1006)
    await clock.advance(249)

    expect(sockets).toHaveLength(2)

    await clock.advance(1)

    expect(sockets).toHaveLength(3)
  })

  it('brings a reconnect forward when the network back draws less than its wait, and never puts it off', async () => {
    const { network, change } = fakeNetwork()
    // A reconnect due in 999 ms; the network back draws 800 ms, then, 100 ms later, 900 ms.
    const { clock, sockets, transport, socket } = harness(
      scripted(0.9999999, 0.8, 0.9),
      () => keys,
      network,
    )

    transport.start()
    socket().drop(1006)
    change(true)
    await clock.advance(100)
    change(true)
    await clock.advance(699)

    expect(sockets).toHaveLength(1)

    await clock.advance(1)

    // It opened when the first draw said, 800 ms after the first network back, not 900 after the second.
    expect(sockets).toHaveLength(2)

    await clock.advance(60_000)

    expect(sockets).toHaveLength(2)
  })

  it('opens no second socket when the network comes back while one opens or is up, and starts its delays over', async () => {
    const { network, change } = fakeNetwork()
    const { clock, sockets, transport, socket } = harness(constant(0.5), () => keys, network)

    // Three closes in a row grew the next delay to 4 seconds (0.5 of 8).
    transport.start()

    for (const delay of [500, 1_000, 2_000]) {
      socket().drop(1006)
      await clock.advance(delay)
    }

    change(false)
    change(true)

    // The socket still opening is left to its own open and hello.
    expect(sockets).toHaveLength(4)
    expect(socket().closedWith).toBeUndefined()

    // It fails, and the next attempt waits a draw from the first step, 500 ms, not 4 seconds.
    socket().drop(1006)
    await clock.advance(499)

    expect(sockets).toHaveLength(4)

    await clock.advance(1)

    expect(sockets).toHaveLength(5)

    socket().open()
    socket().receive(welcome)
    change(false)
    change(true)
    await clock.advance(60_000)

    expect(sockets).toHaveLength(5)
    expect(socket().closedWith).toBeUndefined()
  })

  it('hears the network only while it runs: a stop or an ending stops hearing it', async () => {
    const stopped = fakeNetwork()
    const first = harness(noDraw, () => keys, stopped.network)

    expect(stopped.listening()).toBe(0)

    first.transport.start()
    first.transport.start()

    expect(stopped.listening()).toBe(1)

    first.transport.stop()

    expect(stopped.listening()).toBe(0)

    first.transport.start()

    expect(stopped.listening()).toBe(1)

    const ended = fakeNetwork()
    const second = harness(noDraw, () => keys, ended.network)

    second.connect().drop(4001)

    expect(ended.listening()).toBe(0)

    ended.change(false)
    ended.change(true)
    await second.clock.advance(60_000)

    expect(second.sockets).toHaveLength(1)
    expect(second.events).toEqual(['up', 'ended: revoked', 'down'])
  })

  it("hands the welcome's memberships and a later memberships message to onMemberships", () => {
    const { transport, socket, memberships, received } = harness(noDraw)
    const update: ServerMessage = { type: 'memberships', memberships: [] }

    transport.start()
    socket().open()
    socket().receive({ ...welcome, memberships: [acme] })
    socket().receive(update)

    expect(memberships).toEqual([[acme], []])
    expect(received).toEqual([{ ...welcome, memberships: [acme] }, update])
  })

  it("hands the welcome's roles to onRoles beside its memberships, before any listener hears the welcome", () => {
    const heard: string[] = []
    const sockets: FakeSocket[] = []
    const transport = new WebSocketTransport({
      url: 'wss://gateway.example.test/sync',
      credentials: () => keys,
      onMemberships: (list) => heard.push(`memberships: ${list.length}`),
      onRoles: (roles) => heard.push(`roles: ${roles.join(',')}`),
      onEnded: () => {},
      clock: manualClock(),
      device: 'device-1',
      socket: (url) => {
        const opened = new FakeSocket(url)

        sockets.push(opened)

        return opened
      },
    })

    transport.onMessage((message) => heard.push(`message: ${message.type}`))
    transport.start()

    const socket = sockets[0] ?? expect.unreachable('a socket')

    socket.open()
    socket.receive({ ...welcome, memberships: [acme], roles: ['operator'] })
    // A memberships message changes no roles: only a welcome carries them.
    socket.receive({ type: 'memberships', memberships: [] })

    expect(heard).toEqual([
      'memberships: 1',
      'roles: operator',
      'message: welcome',
      'memberships: 0',
      'message: memberships',
    ])
  })

  it('stops on 4401 and reports unauthorized', async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4401)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: unauthorized', 'down'])
    expect(ended).toEqual(['unauthorized'])
    expect(sockets.length).toBe(1)
  })

  it('stops on 4400 from the gateway and reports protocol, not unauthorized', async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4400)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: protocol', 'down'])
    expect(ended).toEqual(['protocol'])
    expect(sockets.length).toBe(1)
  })

  it('stops on 4001 and reports revoked: the device was signed out from another one', async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4001)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: revoked', 'down'])
    expect(ended).toEqual(['revoked'])
    expect(sockets.length).toBe(1)
  })

  it('stops on 4002 and reports password-changed: the password of the account changed', async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4002)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: password-changed', 'down'])
    expect(ended).toEqual(['password-changed'])
    expect(sockets.length).toBe(1)
  })

  it("stops on 4003 and reports device-limit: a sign-in past the account's limit signed it out", async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4003)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: device-limit', 'down'])
    expect(ended).toEqual(['device-limit'])
    expect(sockets.length).toBe(1)
  })

  it('stops on 4004 and reports banned: an operator banned the account', async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
    const ended: string[] = []

    transport.onEnded((reason) => ended.push(reason))
    connect().drop(4004)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: banned', 'down'])
    expect(ended).toEqual(['banned'])
    expect(sockets.length).toBe(1)
  })

  it('connects again after 4408, a hello the gateway stopped waiting for', async () => {
    const { clock, sockets, transport, socket, events } = harness(constant(0.5))

    transport.start()
    socket().open()
    socket().drop(4408)
    await clock.advance(500)

    expect(sockets.length).toBe(2)
    expect(events).toEqual([])
  })

  it('connects again after 1011, a gateway that failed, as after any close that ends nothing', async () => {
    const { clock, sockets, connect, events } = harness(constant(0.5))

    connect().drop(1011)
    await clock.advance(500)

    expect(events).toEqual(['up', 'down'])
    expect(sockets.length).toBe(2)
  })

  it('stops on 4000 and reports signed-out', async () => {
    const { clock, sockets, connect, events } = harness(noDraw)

    connect().drop(4000)
    await clock.advance(60_000)

    expect(events).toEqual(['up', 'ended: signed-out', 'down'])
    expect(sockets.length).toBe(1)
  })

  it('ends as unauthorized when it holds no token to say hello with', async () => {
    const { clock, sockets, transport, socket, events } = harness(noDraw, () => undefined)

    transport.start()
    socket().open()
    await clock.advance(60_000)

    expect(socket().sent).toEqual([])
    expect(socket().closedWith).toBe(1000)
    expect(events).toEqual(['ended: unauthorized'])
    expect(sockets.length).toBe(1)
  })

  it('closes on a message the protocol refuses and connects again', async () => {
    const { clock, sockets, connect, events } = harness(constant(0.5))
    const socket = connect()

    socket.receiveText('{"type":"welcome"}')

    expect(socket.closedWith).toBe(4400)
    expect(events).toEqual(['up', 'down'])

    // The close the socket reports afterwards changes nothing.
    socket.drop(4400)
    await clock.advance(500)

    expect(events).toEqual(['up', 'down'])
    expect(sockets.length).toBe(2)
  })

  it('send returns false while down', async () => {
    const { clock, transport, socket, connect } = harness(constant(0.5))

    expect(transport.send(probe)).toBe(false)

    transport.start()

    expect(transport.send(probe)).toBe(false)

    connect().drop(1006)

    expect(transport.send(probe)).toBe(false)

    await clock.advance(500)
    socket().open()

    expect(transport.send(probe)).toBe(false)
  })

  it('closes a socket the gateway does not welcome within 10 seconds of opening, and connects again', async () => {
    const { clock, sockets, transport, socket, events } = harness(constant(0.5))

    transport.start()
    socket().open()
    await clock.advance(9_999)

    expect(socket().closedWith).toBeUndefined()

    await clock.advance(1)

    expect(socket().closedWith).toBe(1000)

    await clock.advance(500)

    expect(sockets.length).toBe(2)
    expect(events).toEqual([])
  })

  it('keeps a welcomed socket open past 10 seconds', async () => {
    const { clock, sockets, connect } = harness(noDraw)
    const socket = connect()

    await clock.advance(60_000)

    expect(socket.closedWith).toBeUndefined()
    expect(sockets.length).toBe(1)
  })

  it('closes a welcomed socket on reconnect() and connects again after the first delay of the backoff', async () => {
    const { clock, sockets, transport, socket, events } = harness(constant(0.5))

    // Three closes in a row grew the next step to 8 seconds; the welcome that came starts it over.
    transport.start()

    for (const delay of [500, 1_000, 2_000]) {
      socket().drop(1006)
      await clock.advance(delay)
    }

    socket().open()
    socket().receive(welcome)

    const dead = socket()

    transport.reconnect()

    expect(dead.closedWith).toBe(1000)
    expect(events).toEqual(['up', 'down'])
    expect(transport.send(probe)).toBe(false)

    // The first step's draw, 500 ms, not one of the grown step.
    await clock.advance(499)

    expect(sockets.length).toBe(4)

    await clock.advance(1)

    expect(sockets.length).toBe(5)

    // The close the old socket reports afterwards changes nothing.
    dead.drop(1006)
    await clock.advance(60_000)

    expect(sockets.length).toBe(5)
  })

  it('leaves a socket whose hello is under way alone on reconnect(): its hello is out', async () => {
    const { clock, sockets, transport, socket, events } = harness(noDraw)

    transport.start()
    // Still opening: the hello goes once it opens, with the token held then.
    transport.reconnect()
    socket().open()
    // The hello is out: closing the socket now would only send another one.
    transport.reconnect()

    expect(sockets).toHaveLength(1)
    expect(socket().closedWith).toBeUndefined()
    expect(socket().sent).toEqual([
      {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'session-token',
        device: 'device-1',
      },
    ])

    socket().receive(welcome)
    await clock.advance(60_000)

    expect(events).toEqual(['up'])
    expect(sockets).toHaveLength(1)
  })

  it('still gives up a socket whose hello stays unanswered after reconnect() left it alone', async () => {
    const { clock, sockets, transport, socket, events } = harness(constant(0.5))

    transport.start()
    socket().open()
    transport.reconnect()
    await clock.advance(9_999)

    expect(socket().closedWith).toBeUndefined()

    await clock.advance(1)

    expect(socket().closedWith).toBe(1000)

    await clock.advance(500)

    expect(sockets).toHaveLength(2)
    expect(events).toEqual([])
  })

  it('closes the socket on stop and connects no more', async () => {
    const { clock, sockets, connect, transport, events } = harness(noDraw)
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
