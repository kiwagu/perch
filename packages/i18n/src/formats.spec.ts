import { describe, expect, it } from 'vitest'

import { createFormats } from './formats'

const moment = new Date('2026-10-29T23:30:00Z')

describe('createFormats', () => {
  it('writes a date and a date with its time as the locale writes them, in the given time zone', () => {
    const english = createFormats('en', 'UTC')
    const spanish = createFormats('es', 'UTC')

    expect(english.date(moment)).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(moment),
    )
    expect(spanish.dateTime(moment)).toBe(
      new Intl.DateTimeFormat('es', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(moment),
    )
    expect(english.date(moment)).not.toBe(spanish.date(moment))
  })

  it('moves a moment to the day it is in the given time zone', () => {
    // Half past eleven at night in UTC is already the next morning in Tokyo.
    expect(createFormats('en', 'UTC').date(moment)).toContain('29')
    expect(createFormats('en', 'Asia/Tokyo').date(moment)).toContain('30')
  })

  it('writes a number with the locale digits and separators', () => {
    expect(createFormats('en').number(1234.5)).toBe('1,234.5')
    expect(createFormats('es').number(1234.5)).toBe(new Intl.NumberFormat('es').format(1234.5))
  })

  it('says how long ago or ahead a moment is, in the largest whole unit', () => {
    const now = new Date('2026-10-29T12:00:00Z')
    const english = createFormats('en')
    const words = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    const before = (seconds: number) => new Date(now.getTime() - seconds * 1000)

    expect(english.relative(before(20), now)).toBe(words.format(-20, 'second'))
    expect(english.relative(before(3 * 60), now)).toBe(words.format(-3, 'minute'))
    expect(english.relative(before(5 * 3600), now)).toBe(words.format(-5, 'hour'))
    expect(english.relative(before(24 * 3600), now)).toBe(words.format(-1, 'day'))
    expect(english.relative(before(60 * 24 * 3600), now)).toBe(words.format(-2, 'month'))
    expect(english.relative(before(800 * 24 * 3600), now)).toBe(words.format(-2, 'year'))
    expect(english.relative(new Date(now.getTime() + 2 * 3600 * 1000), now)).toBe(
      words.format(2, 'hour'),
    )
    expect(createFormats('es').relative(before(3 * 60), now)).toBe(
      new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(-3, 'minute'),
    )
  })
})
