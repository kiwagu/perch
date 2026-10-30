import { describe, expect, it } from 'vitest'

import { LocaleWrites } from '../../application/locale-writes'

import { frameLanguageWrites, type ShellLive } from './shell-frame'

const live = (): ShellLive => ({
  account: 'idn_ann',
  stored: undefined,
  writes: LocaleWrites.none,
  generation: 0,
  signOutHere: undefined,
  renderAgain: undefined,
})

describe('frameLanguageWrites', () => {
  it("keeps a write in the frame's record until it fails", () => {
    const frame = live()
    const writes = frameLanguageWrites(frame)
    const failed = writes.writing('es')

    expect(frame.writes.elsewhere('es')).toBeUndefined()

    failed()

    expect(frame.writes.elsewhere('es')).toBe('es')
  })

  it("leaves the next account's writes alone when an earlier account's write fails late", () => {
    const frame = live()
    const writes = frameLanguageWrites(frame)
    const failedForAnn = writes.writing('es')

    // Ann signs out and Bob signs in: the record starts afresh, and Bob writes es too.
    frame.generation += 1
    frame.writes = LocaleWrites.none
    writes.writing('es')
    failedForAnn()

    // Bob's es is still on its way: when it comes back, it is this device's own.
    expect(frame.writes.elsewhere('es')).toBeUndefined()
  })
})
