import { describe, expect, it } from 'vitest'

import { NOTHING_SEEN } from '../../application/setting-writes'

import { frameSettingsWrites, type ShellLive, tabSelfReloads } from './shell-frame'

const live = (): ShellLive => ({
  account: 'idn_ann',
  stored: undefined,
  writes: NOTHING_SEEN,
  generation: 0,
  signOutHere: undefined,
  renderAgain: undefined,
  unsaved: false,
})

describe('frameSettingsWrites', () => {
  it("keeps a write in the frame's record until it fails", () => {
    const frame = live()
    const writes = frameSettingsWrites(frame)
    const failed = writes.locale.writing('es')

    expect(frame.writes.locale.elsewhere('es')).toBeUndefined()

    failed()

    expect(frame.writes.locale.elsewhere('es')).toBe('es')
  })

  it("leaves the next account's writes alone when an earlier account's write fails late", () => {
    const frame = live()
    const writes = frameSettingsWrites(frame)
    const failedForAnn = writes.locale.writing('es')

    // Ann signs out and Bob signs in: the record starts afresh, and Bob writes es too.
    frame.generation += 1
    frame.writes = NOTHING_SEEN
    writes.locale.writing('es')
    failedForAnn()

    // Bob's es is still on its way: when it comes back, it is this tab's own.
    expect(frame.writes.locale.elsewhere('es')).toBeUndefined()
  })
})

describe('tabSelfReloads', () => {
  it("keeps every update this tab loaded the page again for in the tab's storage", () => {
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
    const reloads = tabSelfReloads(() => storage)

    expect(reloads.done('0.2.0+abc')).toBe(false)

    reloads.mark('0.2.0+abc')

    // The page loaded again: a new record over the same storage still knows it.
    expect(tabSelfReloads(() => storage).done('0.2.0+abc')).toBe(true)
    expect(reloads.done('0.3.0+def')).toBe(false)

    // Another update afterwards: the first one stays known, so a server alternating the two
    // starts no loop.
    tabSelfReloads(() => storage).mark('0.3.0+def')

    expect(tabSelfReloads(() => storage).done('0.2.0+abc')).toBe(true)
    expect(tabSelfReloads(() => storage).done('0.3.0+def')).toBe(true)
  })
})
