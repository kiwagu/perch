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

  it('reserves an attempt like a take, and gives it back while its window holds it', () => {
    const { window } = windowOf(2, 10_000)
    const first = window.reserve('a')

    expect(first.allowed).toBe(true)
    expect(window.reserve('a').allowed).toBe(true)
    expect(window.reserve('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })

    if (first.allowed) {
      first.giveBack()
    }

    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a').allowed).toBe(false)
  })

  it('gives a reservation back once, however often its holder asks', () => {
    const { window } = windowOf(2, 10_000)
    const first = window.reserve('a')

    window.reserve('a')

    if (first.allowed) {
      first.giveBack()
      first.giveBack()
    }

    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a').allowed).toBe(false)
  })

  it('gives nothing back to a window that restarted or a key that was forgotten since', async () => {
    const { clock, window } = windowOf(1, 10_000)
    const old = window.reserve('a')

    await clock.advance(10_000)
    expect(window.take('a')).toEqual({ allowed: true })

    if (old.allowed) {
      old.giveBack()
    }

    expect(window.take('a').allowed).toBe(false)

    const forgotten = window.reserve('b')

    window.forget('b')
    expect(window.take('b')).toEqual({ allowed: true })

    if (forgotten.allowed) {
      forgotten.giveBack()
    }

    expect(window.take('b').allowed).toBe(false)
  })

  it('forgets a key', () => {
    const { window } = windowOf(1, 10_000)

    window.take('a')
    window.forget('a')

    expect(window.take('a')).toEqual({ allowed: true })
  })

  it('drops the oldest window, an expired one, to let an unseen key in when the table is full', async () => {
    const { clock, window } = windowOf(1, 10_000, 2)

    window.take('a')
    await clock.advance(5_000)
    window.take('b')
    await clock.advance(5_000)

    expect(window.take('c')).toEqual({ allowed: true })
    expect(window.take('b').allowed).toBe(false)
  })

  it('evicts the oldest window, even a live one, to let an unseen key in: the table never holds more than its keys', () => {
    const { window } = windowOf(1, 10_000, 2)

    window.take('a')
    window.take('b')

    expect(window.take('c')).toEqual({ allowed: true })
    // a was evicted, so it starts fresh, which evicts b in turn; c and a stay counted.
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('b')).toEqual({ allowed: true })
    expect(window.take('a').allowed).toBe(false)
    expect(window.take('b').allowed).toBe(false)
    expect(window.take('c')).toEqual({ allowed: true })
  })

  it('moves a key whose window restarted to the end, after the windows that started before it', async () => {
    const { clock, window } = windowOf(1, 10_000, 2)

    window.take('a')
    await clock.advance(5_000)
    window.take('b')
    await clock.advance(5_000)
    // a's window restarts after b's started: b is now the oldest.
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('c')).toEqual({ allowed: true })

    expect(window.take('a').allowed).toBe(false)
    expect(window.take('b')).toEqual({ allowed: true })
  })
})
