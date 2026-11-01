import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { manualClock } from '@workspace/replica/testing'

import { type MemoryStorage, memoryStorage } from './storage'
import { syncStatus } from './sync-status'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** One browser: its storage, its clock and its network, shared by its tabs. */
function browser() {
  const storage = memoryStorage()
  const clock = manualClock(1_000_000)
  let online = true
  const networkListeners = new Set<() => void>()

  return {
    storage,
    clock,
    goOffline: () => {
      online = false
      for (const listener of networkListeners) {
        listener()
      }
    },
    /** A tab of this browser, signed in unless said otherwise; `unsent` answers its outbox. */
    tab: (
      options: {
        readonly signedIn?: boolean
        readonly canSync?: boolean
        readonly protocolRefused?: () => boolean
      } = {},
    ) => {
      let unsent = false
      const heard = vi.fn()
      const status = syncStatus({
        storage,
        clock,
        online: () => online,
        onOnlineChange: (listener) => {
          networkListeners.add(listener)

          return () => networkListeners.delete(listener)
        },
        signedIn: () => options.signedIn ?? true,
        unsent: () => okAsync(unsent),
        protocolRefused: options.protocolRefused ?? (() => false),
        canSync: options.canSync ?? true,
      })

      status.subscribe(heard)

      return {
        status,
        heard,
        hold: (next: boolean) => {
          unsent = next
        },
      }
    },
  }
}

/** The leader's record reaches the other tabs as a change made elsewhere. */
const tellOthers = (storage: MemoryStorage) =>
  storage.changeElsewhere('perch.sync.leader', storage.get('perch.sync.leader'))

describe('syncStatus', () => {
  it('says nothing while nobody is signed in', () => {
    const page = browser().tab({ signedIn: false })

    page.status.syncState({ leader: true, channel: 'up' })

    expect(page.status.current()).toBeUndefined()
  })

  it('connects, then says synced in the tab that leads and in another tab of the browser', async () => {
    const device = browser()
    const leader = device.tab()
    const other = device.tab()

    leader.status.syncState({ leader: true, channel: 'down' })

    expect(leader.status.current()).toBe('connecting')

    leader.status.syncState({ leader: true, channel: 'up' })
    await settle()
    tellOthers(device.storage)

    expect(leader.status.current()).toBe('synced')
    expect(other.status.current()).toBe('synced')
    expect(other.heard).toHaveBeenCalled()
  })

  it('says changes are on their way while the outbox holds them, and synced once they are sent', async () => {
    const device = browser()
    const leader = device.tab()

    leader.hold(true)
    leader.status.syncState({ leader: true, channel: 'up' })
    await settle()

    expect(leader.status.current()).toBe('sending')

    leader.hold(false)
    await device.clock.advance(2_000)
    await settle()

    expect(leader.status.current()).toBe('synced')
  })

  it('says offline when the browser has no network, whatever the leading tab last said', async () => {
    const device = browser()
    const leader = device.tab()
    const other = device.tab()

    leader.status.syncState({ leader: true, channel: 'up' })
    await settle()
    other.heard.mockClear()
    device.goOffline()

    expect(leader.status.current()).toBe('offline')
    expect(other.status.current()).toBe('offline')
    expect(other.heard).toHaveBeenCalled()
  })

  it('says connecting again in another tab once the leading tab went away without a word', async () => {
    const device = browser()
    const other = device.tab()

    // What a leading tab wrote before its page closed: refreshed no more.
    device.storage.set(
      'perch.sync.leader',
      JSON.stringify({ channel: 'up', waiting: false, stopped: false, at: device.clock.now() }),
    )

    expect(other.status.current()).toBe('synced')

    other.heard.mockClear()
    await device.clock.advance(8_000)

    expect(other.status.current()).toBe('connecting')
    expect(other.heard).toHaveBeenCalled()
  })

  it('says stopped for a protocol the gateway refused, in the tab that heard it and in the others', async () => {
    const device = browser()
    let refused = false
    const leader = device.tab({ protocolRefused: () => refused })
    const other = device.tab()

    leader.status.syncState({ leader: true, channel: 'up' })
    await settle()
    refused = true
    leader.status.syncState({ leader: true, channel: 'down' })
    tellOthers(device.storage)

    expect(leader.status.current()).toBe('sync-stopped')
    expect(other.status.current()).toBe('sync-stopped')
    // Stopped says more than offline.
    device.goOffline()

    expect(other.status.current()).toBe('sync-stopped')
  })

  it('says stopped in a browser that cannot lead a sync', () => {
    expect(browser().tab({ canSync: false }).status.current()).toBe('sync-stopped')
  })

  it('takes its record away when it stops leading, and reads none it did not write', () => {
    const device = browser()
    const leader = device.tab()

    leader.status.syncState({ leader: true, channel: 'up' })

    expect(device.storage.get('perch.sync.leader')).toBeDefined()

    leader.status.syncState({ leader: false, channel: 'down' })

    expect(device.storage.get('perch.sync.leader')).toBeUndefined()

    device.storage.set('perch.sync.leader', 'not a record')

    expect(device.tab().status.current()).toBe('connecting')
  })

  describe('reads of the outbox', () => {
    /** A leading tab whose reads of the outbox the test answers, in any order. */
    function leaderWithReads() {
      const storage = memoryStorage()
      const clock = manualClock(1_000_000)
      const reads: Array<{ answer: (unsent: boolean) => void; fail: () => void }> = []
      const status = syncStatus({
        storage,
        clock,
        online: () => true,
        onOnlineChange: () => () => {},
        signedIn: () => true,
        unsent: () =>
          ResultAsync.fromPromise(
            new Promise<boolean>((answer, fail) => {
              reads.push({ answer, fail: () => fail(new Error('the outbox did not read')) })
            }),
            () => dataError('data:WRITE_FAILED', 'the outbox did not read'),
          ),
        protocolRefused: () => false,
        canSync: true,
      })

      return { storage, clock, reads, status }
    }

    it('says synced only once a read found nothing waiting, and not after a read failed', async () => {
      const { clock, reads, status } = leaderWithReads()

      status.syncState({ leader: true, channel: 'up' })

      // Up, but nothing read yet: changes may still wait.
      expect(status.current()).toBe('sending')

      reads[0]?.answer(false)
      await settle()

      expect(status.current()).toBe('synced')

      await clock.advance(2_000)
      reads[1]?.fail()
      await settle()

      expect(status.current()).toBe('sending')
    })

    it('takes no answer asked before a later question, nor in an earlier leading period', async () => {
      const { reads, status } = leaderWithReads()

      status.syncState({ leader: true, channel: 'down' })
      status.syncState({ leader: true, channel: 'up' })
      // The later question answers first, changes waiting; the earlier one, answering "none"
      // after it, is not taken.
      reads[1]?.answer(true)
      await settle()
      reads[0]?.answer(false)
      await settle()

      expect(status.current()).toBe('sending')

      // A question asked in this leading period, still unanswered when the tab stops leading and
      // leads again (another account, say): its late "none" is not the new period's.
      status.syncState({ leader: true, channel: 'up' })
      status.syncState({ leader: false, channel: 'down' })
      status.syncState({ leader: true, channel: 'up' })
      reads[2]?.answer(false)
      await settle()

      expect(status.current()).toBe('sending')

      reads[3]?.answer(false)
      await settle()

      expect(status.current()).toBe('synced')
    })

    it('writes nothing more once stopped, whatever a read still under way answers', async () => {
      const { storage, reads, status } = leaderWithReads()

      status.syncState({ leader: true, channel: 'up' })
      status.stop()
      reads[0]?.answer(false)
      await settle()

      expect(storage.get('perch.sync.leader')).toBeUndefined()

      status.syncState({ leader: true, channel: 'up' })

      expect(storage.get('perch.sync.leader')).toBeUndefined()
    })
  })
})
