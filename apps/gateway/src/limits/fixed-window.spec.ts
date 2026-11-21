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

/** The reservation `window` makes of `key`, which must be allowed. */
function reservedOf(window: FixedWindow, key: string) {
  const reservation = window.reserve(key)

  return reservation.allowed ? reservation : expect.unreachable('a reservation')
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

  it('leaves no window behind a reservation of an unseen key that was given back: the next window starts at its first take', async () => {
    const { clock, window } = windowOf(2, 10_000)

    reservedOf(window, 'a').giveBack()
    // Just before the deadline the empty window would have had.
    await clock.advance(9_999)
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
  })

  it.each([
    ['in the order they were taken', false],
    ['in the reverse order', true],
  ])(
    'leaves no window behind two reservations of an unseen key given back %s',
    async (_, reversed) => {
      const { clock, window } = windowOf(2, 10_000)
      const held = [reservedOf(window, 'a'), reservedOf(window, 'a')]

      for (const reservation of reversed ? held.reverse() : held) {
        reservation.giveBack()
      }

      await clock.advance(9_999)
      expect(window.take('a')).toEqual({ allowed: true })
      expect(window.take('a')).toEqual({ allowed: true })
      expect(window.take('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
    },
  )

  it('keeps the window of a key while an attempt other than the one given back still counts', async () => {
    const { clock, window } = windowOf(2, 10_000)
    const reservation = reservedOf(window, 'a')

    expect(window.take('a')).toEqual({ allowed: true })
    reservation.giveBack()
    await clock.advance(9_999)
    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a')).toEqual({ allowed: false, retryAfterMs: 1 })
  })

  it('keeps a reservation in the window that counted it, once, however often its holder asks', () => {
    const { window } = windowOf(2, 10_000)
    const reservation = reservedOf(window, 'a')

    reservation.keep()
    reservation.keep()
    reservation.giveBack()

    expect(window.take('a')).toEqual({ allowed: true })
    expect(window.take('a').allowed).toBe(false)
  })

  it('counts a reservation kept after its key was forgotten in the window as it is then, opening one', async () => {
    const { clock, window } = windowOf(2, 10_000)
    const reservation = reservedOf(window, 'a')

    window.forget('a')
    await clock.advance(1_000)
    reservation.keep()

    expect(window.take('a')).toEqual({ allowed: true })
    // The window opened when the reservation was kept, a second after the forgetting.
    expect(window.take('a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
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
