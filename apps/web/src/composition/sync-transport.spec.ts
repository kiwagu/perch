import { afterEach, describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'
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
import type { DeviceNetwork, SyncTransport } from '@workspace/replica/sync'
import { manualClock } from '@workspace/replica/testing'

import { SessionRoles, sessionTransportContext } from './session'
import { deviceIdFrom, memoryStorage, saveDevice, savedRoles } from './storage'
import { syncTransport } from './sync-transport'

/** A socket the test opens, feeds and closes by hand; it keeps what the transport sent. */
class FakeSocket extends EventTarget {
  readonly sent: ClientMessage[] = []

  constructor(readonly url: string) {
    super()
  }

  send(text: string): void {
    this.sent.push(decodeMessage(clientMessage, text)._unsafeUnwrap())
  }

  close(): void {}

  open(): void {
    this.dispatchEvent(new Event('open'))
  }

  receive(message: ServerMessage): void {
    this.dispatchEvent(new MessageEvent('message', { data: encodeMessage(serverMessage, message) }))
  }

  drop(code: number): void {
    this.dispatchEvent(new CloseEvent('close', { code }))
  }
}

const ann = identityIdFactory.create()

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

/** The gateway's welcome of Ann's device, with `roles`. */
function welcomeWith(roles: readonly PlatformRole[]): ServerMessage {
  return {
    type: 'welcome',
    identity: ann,
    regions: [],
    memberships: [acme],
    roles: [...roles],
    time: 0,
  }
}

const started: SyncTransport[] = []

afterEach(() => {
  for (const transport of started.splice(0)) {
    transport.stop()
  }
})

/**
 * Ann's browser, signed in, and the channel of her identity as the browser and the seed build it:
 * the context the session gives it (`sessionTransportContext`) over her roles on the browser's
 * storage, and the factory they call, over fake sockets.
 */
function annChannel(device: { readonly network?: DeviceNetwork } = {}) {
  const storage = memoryStorage()

  saveDevice(storage, {
    identity: { id: ann, email: 'ann@example.test' },
    token: 'token-ann',
    memberships: [],
  })

  const roles = new SessionRoles({ storage, shown: () => ann })
  const told: Array<readonly PlatformRole[]> = []
  const memberships: Array<readonly Membership[]> = []
  const heard: string[] = []
  const hear = (name: string) => () => {
    heard.push(name)
  }

  roles.subscribe((held) => told.push([...held]))

  const context = sessionTransportContext(ann, storage, {
    memberships: (list) => memberships.push(list),
    roles: (held) => roles.apply(ann, held),
    refused: hear('refused'),
    revoked: hear('revoked'),
    passwordChanged: hear('passwordChanged'),
    deviceLimit: hear('deviceLimit'),
    banned: hear('banned'),
    protocolRefused: hear('protocolRefused'),
  })
  const clock = manualClock()
  const sockets: FakeSocket[] = []
  const transport = syncTransport({
    ...device,
    url: 'wss://gateway.example.test/sync',
    clock,
    socket: (url) => {
      const socket = new FakeSocket(url)

      sockets.push(socket)

      return socket
    },
  })(context)

  started.push(transport)
  transport.start()

  /** The socket opened last, opened: the transport said hello on it. */
  const opened = (): FakeSocket => {
    const socket = sockets.at(-1) ?? expect.unreachable('a socket')

    socket.open()

    return socket
  }

  return { storage, roles, told, memberships, heard, clock, sockets, opened }
}

describe('syncTransport: the channel the browser and the seed open', () => {
  it("says hello with the device and the token the context gives, at the factory's address", () => {
    const { storage, sockets, opened } = annChannel()
    const socket = opened()

    expect(sockets.map(({ url }) => url)).toEqual(['wss://gateway.example.test/sync'])
    expect(socket.sent).toEqual([
      expect.objectContaining({ type: 'hello', token: 'token-ann', device: deviceIdFrom(storage) }),
    ])
  })

  it("keeps a welcome's roles in the identity's record and tells the subscribers", () => {
    const { storage, roles, told, opened } = annChannel()

    opened().receive(welcomeWith(['operator']))

    expect(savedRoles(storage, ann)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
    expect(told).toEqual([['operator']])
  })

  it('takes the role away when a later welcome does not carry it', async () => {
    const { storage, roles, told, clock, opened } = annChannel()

    opened().receive(welcomeWith(['operator']))
    // The connection is lost; the device connects again and is welcomed anew, without the role.
    opened().drop(1006)
    await clock.advance(1_000)
    opened().receive(welcomeWith([]))

    expect(savedRoles(storage, ann)).toEqual([])
    expect(roles.current().size).toBe(0)
    expect(told).toEqual([['operator'], []])
  })

  it("hands the welcome's memberships to the context", () => {
    const { memberships, opened } = annChannel()

    opened().receive(welcomeWith([]))

    expect(memberships).toEqual([[acme]])
  })

  it('tells the context how the channel ended', () => {
    const { heard, opened } = annChannel()
    const socket = opened()

    socket.receive(welcomeWith(['operator']))
    socket.drop(CLOSE.banned)

    expect(heard).toEqual(['banned'])
  })

  it("hears the device's network: a reconnect waiting connects at once once it is back", () => {
    const listeners = new Set<() => void>()
    const { sockets, opened } = annChannel({
      network: {
        online: () => true,
        onOnlineChange: (listener) => {
          listeners.add(listener)

          return () => listeners.delete(listener)
        },
      },
    })

    opened().drop(1006)

    for (const listener of listeners) {
      listener()
    }

    expect(sockets).toHaveLength(2)
  })
})
