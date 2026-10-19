import { describe, expect, it } from 'vitest'

import { FakeHintChannel } from '../testing/fake-hint-channel'

import { type SyncHint, syncHints } from './hints'

describe('syncHints', () => {
  it('a hint reaches the other tabs, not the sender', () => {
    const bus = new Set<FakeHintChannel>()
    const sender = syncHints(new FakeHintChannel(bus))
    const receiver = syncHints(new FakeHintChannel(bus))
    const sent: SyncHint[] = []
    const received: SyncHint[] = []

    sender.on((hint) => sent.push(hint))
    receiver.on((hint) => received.push(hint))
    sender.post('journal')
    expect(received).toEqual(['journal'])
    expect(sent).toEqual([])
  })

  it('a sign-out hint reaches the other tabs', () => {
    const bus = new Set<FakeHintChannel>()
    const sender = syncHints(new FakeHintChannel(bus))
    const receiver = syncHints(new FakeHintChannel(bus))
    const received: SyncHint[] = []

    receiver.on((hint) => received.push(hint))
    sender.post('sign-out')
    sender.post('kick')
    expect(received).toEqual(['sign-out', 'kick'])
  })

  it('a renew hint reaches the other tabs', () => {
    const bus = new Set<FakeHintChannel>()
    const sender = syncHints(new FakeHintChannel(bus))
    const receiver = syncHints(new FakeHintChannel(bus))
    const received: SyncHint[] = []

    receiver.on((hint) => received.push(hint))
    sender.post('renew')
    expect(received).toEqual(['renew'])
  })

  it('a reset hint reaches the other tabs', () => {
    const bus = new Set<FakeHintChannel>()
    const sender = syncHints(new FakeHintChannel(bus))
    const receiver = syncHints(new FakeHintChannel(bus))
    const received: SyncHint[] = []

    receiver.on((hint) => received.push(hint))
    sender.post('reset')
    expect(received).toEqual(['reset'])
  })

  it('an unknown message on the channel is ignored', () => {
    const bus = new Set<FakeHintChannel>()
    const raw = new FakeHintChannel(bus)
    const receiver = syncHints(new FakeHintChannel(bus))
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

  it('close stops listening, closes the channel and makes posting a no-op', () => {
    const bus = new Set<FakeHintChannel>()
    const channel = new FakeHintChannel(bus)
    const receiver = syncHints(channel)
    const sender = syncHints(new FakeHintChannel(bus))
    const received: SyncHint[] = []

    receiver.on((hint) => received.push(hint))
    receiver.close()
    sender.post('kick')
    expect(() => receiver.post('kick')).not.toThrow()
    receiver.close()
    expect(channel.closed).toBe(true)
    expect(channel.handlers.size).toBe(0)
    expect(received).toEqual([])
  })

  it('an unsubscribed listener hears nothing more', () => {
    const bus = new Set<FakeHintChannel>()
    const sender = syncHints(new FakeHintChannel(bus))
    const receiver = syncHints(new FakeHintChannel(bus))
    const received: SyncHint[] = []
    const off = receiver.on((hint) => received.push(hint))

    sender.post('kick')
    off()
    sender.post('journal')
    expect(received).toEqual(['kick'])
  })
})
