import { describe, expect, it } from 'vitest'

import { manualClock } from '@workspace/replica/testing'

import { FixedWindow } from './fixed-window'

function windowOf(limit: number, windowMs: number, maxKeys?: number) {
  const clock = manualClock(1_000)
  const window = new FixedWindow({
    limit,
    windowMs,
    clock,
    ...(maxKeys === undefined ? {} : { maxKeys }),
  })

  return { clock, window }
}

describe('FixedWindow', () => {
  it('lets limit takes through and refuses the next with the rest of the window', async () => {
    const { clock, window } = windowOf(2, 10_000)

    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: true })
    await clock.advance(3_000)
    expect(window.take('a')).toEqual({ allowed: false, retryAfterMs: 7_000 })
  })

  it('counts nothing for a refused take', async () => {
    const { clock, window } = windowOf(1, 10_000)

    window.take('a')
    await clock.advance(4_000)
    window.take('a')
    window.take('a')
    await clock.advance(6_000)

    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
  })

  it('lets limit more through in a new window', async () => {
    const { clock, window } = windowOf(2, 10_000)

    window.take('a')
    window.take('a')
    await clock.advance(9_999)
    expect(window.take('a').allowed).toBe(false)
    await clock.advance(1)
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a').allowed).toBe(false)
  })

  it('keeps keys independent', () => {
    const { window } = windowOf(1, 10_000)

    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('b')).toEqual({ allowed: true })
    expect(window.take('a').allowed).toBe(false)
  })

  it('never counts on check', () => {
    const { window } = windowOf(1, 10_000)

    expect(window.check('a')).toEqual({ allowed: true })
    expect(window.check('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.check('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
  })

  it('refuses a check at the limit after counts', () => {
    const { window } = windowOf(2, 10_000)

    window.count('a')
    expect(window.check('a').allowed).toBe(true)
    window.count('a')
    expect(window.check('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
  })

  it('forgets a key', () => {
    const { window } = windowOf(1, 10_000)

    window.count('a')
    window.forget('a')

    expect(window.take('a')).toEqual({ allowed: true })
  })

  it('sweeps expired keys when the table is full and lets an unseen key in', async () => {
    const { clock, window } = windowOf(1, 10_000, 2)

    window.take('a')
    await clock.advance(5_000)
    window.take('b')
    await clock.advance(5_000)

    expect(window.take('c')).toEqual({ allowed: true })
    expect(window.take('b').allowed).toBe(false)
  })

  it('refuses an unseen key while the table is full of live keys, keeping the known ones counted', () => {
    const { window } = windowOf(1, 10_000, 2)

    window.take('a')
    window.take('b')

    expect(window.take('c')).toEqual({ allowed: false, retryAfterMs: 10_000 })
    expect(window.check('c')).toEqual({ allowed: false, retryAfterMs: 10_000 })
    expect(window.take('a').allowed).toBe(false)
    expect(window.take('b').allowed).toBe(false)
  })
})
