import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import type { Clock } from '@workspace/replica'
import { manualClock } from '@workspace/replica/testing'

import { sharedStorage } from './__fixtures__/shared-storage'
import type { Visibility } from './identity-space'
import type { VisibilitySource } from './session'
import { type MemoryStorage, memoryStorage } from './storage'
import { syncStatus } from './sync-status'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A tab always in view. */
const inView: VisibilitySource = { current: () => 'visible', onChange: () => () => {} }

/** A leader's record as a tab the test does not open wrote it. */
const record = (at: number) => JSON.stringify({ channel: 'up', waiting: false, stopped: false, at })

/**
 * A tab hidden long enough for the browser to hold its timers back, as Chrome does once a tab has
 * stayed hidden for minutes: a timer set while it is hidden runs at the next whole minute at the
 * soonest. Its time is the browser's. Shown again, the tab hears that it is visible first, then
 * runs at once every timer whose time came, and the others when they fall due.
 */
function hiddenTab(
  clock: Clock,
): Clock & { readonly visibility: VisibilitySource; show(): void; hide(): void } {
  const MINUTE = 60_000
  let state: Visibility = 'hidden'
  const listeners = new Set<(state: Visibility) => void>()
  const tell = () => {
    for (const listener of [...listeners]) {
      listener(state)
    }
  }
  const held = new Set<{ readonly due: number; readonly run: () => void; cancel: () => void }>()

  return {
    now: () => clock.now(),
    schedule(ms, run) {
      if (state === 'visible') {
        return clock.schedule(ms, run)
      }

      const due = clock.now() + ms
      const timer = { due, run, cancel: () => {} }

      timer.cancel = clock.schedule(Math.ceil(due / MINUTE) * MINUTE - clock.now(), () => {
        held.delete(timer)
        run()
      })
      held.add(timer)

      return () => {
        held.delete(timer)
        timer.cancel()
      }
    },
    visibility: {
      current: () => state,
      onChange: (listener) => {
        listeners.add(listener)

        return () => listeners.delete(listener)
      },
    },
    hide() {
      state = 'hidden'
      tell()
    },
    show() {
      state = 'visible'
      tell()

      for (const timer of [...held]) {
        held.delete(timer)
        timer.cancel()
        timer.cancel = clock.schedule(Math.max(0, timer.due - clock.now()), timer.run)
      }
    },
  }
}

/**
 * One browser whose tabs share their storage the way its `storage` event tells it, each tab with
 * timers of its own: the browser's, or those of a hidden tab. The browser's clock is the wall
 * clock, which may be set back.
 */
function tabsOfOneBrowser() {
  const storage = sharedStorage()
  const clock = manualClock(1_000_000)
  let shift = 0
  const wall: Clock = {
    now: () => clock.now() + shift,
    schedule: (ms, run) => clock.schedule(ms, run),
  }

  return {
    clock,
    wall,
    storage,
    /** Sets the wall clock back by `ms`, as a correction of the system's time does. */
    setBack: (ms: number) => {
      shift -= ms
    },
    /**
     * A signed-in tab with nothing waiting in its outbox, in view unless its timers say otherwise;
     * `view` is its storage, which the test may hand a change late.
     */
    tab: (
      timers: Clock & { readonly visibility?: VisibilitySource } = wall,
      view: MemoryStorage = storage.tab(),
    ) =>
      syncStatus({
        storage: view,
        clock: timers,
        online: () => true,
        onOnlineChange: () => () => {},
        signedIn: () => true,
        unsent: () => okAsync(false),
        protocolRefused: () => false,
        canSync: true,
        visibility: timers.visibility ?? inView,
        // The browser's steady clock: setting the wall clock back does not move it.
        steady: () => clock.now(),
      }),
    /** Lets `ms` pass a second at a time, each tab hearing the others' writes in between. */
    pass: async (ms: number) => {
      for (let passed = 0; passed < ms; passed += 1_000) {
        await clock.advance(1_000)
        await settle()
      }
    },
  }
}

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
        visibility: inView,
        steady: () => clock.now(),
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
    device.storage.changeElsewhere(
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
        visibility: inView,
        steady: () => clock.now(),
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

  describe('a leading tab the browser holds back while it is hidden', () => {
    it('keeps saying synced in a tab in view for minutes while the hidden leader runs its timers once a minute', async () => {
      const browser = tabsOfOneBrowser()
      const leader = browser.tab(hiddenTab(browser.wall))
      const shown = browser.tab()

      leader.syncState({ leader: true, channel: 'up' })
      await settle()

      for (let second = 1; second <= 180; second += 1) {
        await browser.pass(1_000)

        expect(shown.current(), `after ${second} s`).toBe('synced')
      }
    })

    it('says synced at once in a tab opened while the hidden leader has not refreshed its record for most of a minute', async () => {
      const browser = tabsOfOneBrowser()
      const leader = browser.tab(hiddenTab(browser.wall))

      leader.syncState({ leader: true, channel: 'up' })
      await settle()
      await browser.pass(50_000)

      const opened = browser.tab()

      expect(opened.current()).toBe('synced')

      await settle()

      expect(opened.current()).toBe('synced')

      await browser.pass(10_000)

      expect(opened.current()).toBe('synced')
    })

    it('says synced the moment a tab comes back into view after both tabs stayed hidden for minutes', async () => {
      const browser = tabsOfOneBrowser()
      const leader = browser.tab(hiddenTab(browser.wall))
      const tab = hiddenTab(browser.wall)

      tab.show()

      const shown = browser.tab(tab)

      leader.syncState({ leader: true, channel: 'up' })
      await settle()
      // In view for a while, asking the hidden leader and heard back; then hidden too.
      await browser.pass(30_000)
      tab.hide()
      // Shown between two of its held-back wake-ups: it hears that it is visible before its
      // overdue timer runs.
      await browser.pass(5 * 60_000 + 30_000)
      tab.show()

      expect(shown.current()).toBe('synced')

      await browser.clock.advance(0)

      expect(shown.current()).toBe('synced')

      await settle()

      expect(shown.current()).toBe('synced')
    })

    it('keeps saying synced in a tab back into view when the news of the leader’s last beat reaches it after its ask', async () => {
      const browser = tabsOfOneBrowser()
      const leader = browser.tab(hiddenTab(browser.wall))
      const tab = hiddenTab(browser.wall)
      const view = browser.storage.tab()
      const shown = browser.tab(tab, view)

      leader.syncState({ leader: true, channel: 'up' })
      await settle()
      await browser.pass(5 * 60_000 + 30_000)
      tab.show()

      // The storage event of the leader's last beat, told only now, after the tab's ask.
      const last = view.get('perch.sync.leader')

      view.changeElsewhere('perch.sync.leader', last)

      expect(shown.current()).toBe('synced')

      await settle()

      // The leader answered the ask with a record of its own.
      expect(view.get('perch.sync.leader')).not.toBe(last)
      expect(shown.current()).toBe('synced')
    })

    it('says synced the moment the leading tab itself comes back into view after minutes hidden', async () => {
      const browser = tabsOfOneBrowser()
      const tab = hiddenTab(browser.wall)
      const leader = browser.tab(tab)

      leader.syncState({ leader: true, channel: 'up' })
      await settle()
      await browser.pass(5 * 60_000 + 30_000)
      tab.show()

      expect(leader.current()).toBe('synced')
    })

    it('still says connecting in a tab in view when the hidden leader loses its channel, and synced once it is back', async () => {
      const browser = tabsOfOneBrowser()
      const leader = browser.tab(hiddenTab(browser.wall))
      const shown = browser.tab()

      leader.syncState({ leader: true, channel: 'up' })
      await browser.pass(90_000)
      leader.syncState({ leader: true, channel: 'down' })
      await settle()

      expect(shown.current()).toBe('connecting')

      await browser.pass(30_000)

      expect(shown.current()).toBe('connecting')

      leader.syncState({ leader: true, channel: 'up' })
      await settle()

      expect(shown.current()).toBe('synced')
    })

    it('says connecting within ten seconds in a tab in view once the leader neither refreshes its record nor answers', async () => {
      const browser = tabsOfOneBrowser()
      const shown = browser.tab()

      // A leader whose page stopped running: its record stays, and it hears nothing.
      browser.storage.tab().set('perch.sync.leader', record(browser.wall.now()))
      await settle()

      expect(shown.current()).toBe('synced')

      await browser.pass(10_000)

      expect(shown.current()).toBe('connecting')

      await browser.pass(60_000)

      expect(shown.current()).toBe('connecting')
    })

    it('does not take the late news of a silent leader’s last word for a fresh one', async () => {
      const browser = tabsOfOneBrowser()
      const view = browser.storage.tab()
      const shown = browser.tab(browser.wall, view)

      // The leader's last word, whose storage event this tab is told only ten seconds later.
      view.set('perch.sync.leader', record(browser.wall.now()))
      await browser.pass(10_000)

      expect(shown.current()).toBe('connecting')

      view.changeElsewhere('perch.sync.leader', view.get('perch.sync.leader'))

      expect(shown.current()).toBe('connecting')
    })

    it('does not take a removed record for a word of the leader', async () => {
      const browser = tabsOfOneBrowser()
      const view = browser.storage.tab()
      const shown = browser.tab(browser.wall, view)

      view.changeElsewhere('perch.sync.leader', record(browser.wall.now()))
      await browser.pass(10_000)
      view.changeElsewhere('perch.sync.leader', undefined)
      // A record left in storage that this tab has not heard written since.
      view.set('perch.sync.leader', record(browser.wall.now() - 10_000))

      expect(shown.current()).toBe('connecting')
    })

    it('writes a record of its own for every beat, two within one millisecond too', async () => {
      const browser = tabsOfOneBrowser()
      const view = browser.storage.tab()
      const leader = browser.tab(browser.wall, view)

      leader.syncState({ leader: true, channel: 'up' })
      await settle()

      const before = view.get('perch.sync.leader')

      // Another tab asks within the same millisecond: the answer must reach it as a change.
      browser.storage.tab().set('perch.sync.ask', 'now')
      await settle()

      expect(view.get('perch.sync.leader')).not.toBe(before)
    })
  })

  describe('a wall clock set back', () => {
    it('keeps saying synced in a tab in view while the clock is set back under a hidden leader that answers', async () => {
      const browser = tabsOfOneBrowser()
      const leader = browser.tab(hiddenTab(browser.wall))
      const shown = browser.tab()

      leader.syncState({ leader: true, channel: 'up' })
      await browser.pass(30_000)
      browser.setBack(60_000)

      expect(shown.current()).toBe('synced')

      for (let second = 1; second <= 90; second += 1) {
        await browser.pass(1_000)

        expect(shown.current(), `after ${second} s`).toBe('synced')
      }
    })

    it('says connecting from seven seconds after the leader’s last word, wherever the clock is set back meanwhile, and stays so', async () => {
      const browser = tabsOfOneBrowser()
      const shown = browser.tab()

      // A leader whose page stops running right after this word.
      browser.storage.tab().set('perch.sync.leader', record(browser.wall.now()))
      await settle()
      await browser.pass(5_000)
      browser.setBack(60_000)

      for (let second = 6; second <= 80; second += 1) {
        await browser.pass(1_000)

        if (second >= 7) {
          expect(shown.current(), `after ${second} s`).toBe('connecting')
        }
      }
    })

    it('says connecting from seven seconds after the leader’s last word, written once the clock was set back', async () => {
      const browser = tabsOfOneBrowser()
      const shown = browser.tab()
      const leader = browser.storage.tab()

      leader.set('perch.sync.leader', record(browser.wall.now()))
      await settle()
      await browser.pass(5_000)
      browser.setBack(60_000)
      // The leader's last word, at the time set back; then its page stops running.
      leader.set('perch.sync.leader', record(browser.wall.now()))
      await settle()

      expect(shown.current()).toBe('synced')

      for (let second = 1; second <= 80; second += 1) {
        await browser.pass(1_000)

        if (second >= 7) {
          expect(shown.current(), `after ${second} s`).toBe('connecting')
        }
      }
    })

    it('says connecting within four seconds in a tab opened after the clock was set back, on a record its silent leader wrote before', async () => {
      const browser = tabsOfOneBrowser()

      browser.storage.tab().set('perch.sync.leader', record(browser.wall.now()))
      await settle()
      browser.setBack(60_000)

      const opened = browser.tab()

      for (let second = 1; second <= 80; second += 1) {
        await browser.pass(1_000)

        if (second >= 4) {
          expect(opened.current(), `after ${second} s`).toBe('connecting')
        }
      }
    })
  })
})
