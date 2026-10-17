import { describe, expect, it } from 'vitest'

import { type HintChannel, type SyncHint, syncHints } from './hints'

type Handler = (event: { readonly data: unknown }) => void

/** Like a `BroadcastChannel`: a message reaches every channel on the bus except the sender. */
class FakeChannel implements HintChannel {
  closed = false
  readonly handlers = new Set<Handler>()

  constructor(private readonly bus: Set<FakeChannel>) {
    bus.add(this)
  }

  postMessage(message: unknown): void {
    for (const channel of this.bus) {
      if (channel === this) continue
      for (const handler of [...channel.handlers]) handler({ data: message })
    }
  }

  addEventListener(_type: 'message', listener: Handler): void {
    this.handlers.add(listener)
  }

  removeEventListener(_type: 'message', listener: Handler): void {
    this.handlers.delete(listener)
  }

  close(): void {
    this.closed = true
    this.bus.delete(this)
  }
}

describe('syncHints', () => {
  it('a hint reaches the other tabs, not the sender', () => {
    const bus = new Set<FakeChannel>()
    const sender = syncHints(new FakeChannel(bus))
    const receiver = syncHints(new FakeChannel(bus))
    const sent: SyncHint[] = []
    const received: SyncHint[] = []

    sender.on((hint) => sent.push(hint))
    receiver.on((hint) => received.push(hint))
    sender.post('journal')
    expect(received).toEqual(['journal'])
    expect(sent).toEqual([])
  })

  it('an unknown message on the channel is ignored', () => {
    const bus = new Set<FakeChannel>()
    const raw = new FakeChannel(bus)
    const receiver = syncHints(new FakeChannel(bus))
    const received: SyncHint[] = []

    receiver.on((hint) => received.push(hint))
    raw.postMessage('journal')
    raw.postMessage({ kind: 'other', hint: 'journal' })
    raw.postMessage({ kind: 'perch-sync-hint', hint: 'reboot' })
    raw.postMessage({ kind: 'perch-sync-hint', hint: 'kick' })
    expect(received).toEqual(['kick'])
  })

  it('no BroadcastChannel: posting is a no-op', () => {
    const hints = syncHints(undefined)
    const received: SyncHint[] = []
    const off = hints.on((hint) => received.push(hint))

    hints.post('kick')
    off()
    hints.close()
    expect(received).toEqual([])
  })

  it('close stops listening and closes the channel', () => {
    const bus = new Set<FakeChannel>()
    const channel = new FakeChannel(bus)
    const receiver = syncHints(channel)
    const received: SyncHint[] = []

    receiver.on((hint) => received.push(hint))
    receiver.close()
    expect(channel.closed).toBe(true)
    expect(channel.handlers.size).toBe(0)
  })
})
