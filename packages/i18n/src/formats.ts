import type { Locale } from './translator'

/** How the app writes what the user reads that is not a sentence: moments, numbers, distances in time. */
export interface Formats {
  /** A calendar day: "Oct 29, 2026". */
  date(value: Date): string
  /** A day with its time: "Oct 29, 2026, 3:04 PM". */
  dateTime(value: Date): string
  /** A number with the locale's digits and separators: "1,234.5". */
  number(value: number): string
  /** How long ago or ahead a moment is from `now`, in the largest whole unit: "3 minutes ago". */
  relative(value: Date, now?: Date): string
}

/** The units of a relative time, the largest first, each with its length in seconds. */
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

/**
 * The formats of one locale, in `timeZone` (an IANA name such as `Europe/Madrid`) or, without
 * one, in the runtime's own time zone, the zone the user's device is set to.
 */
export function createFormats(locale: Locale, timeZone?: string): Formats {
  const zone = timeZone === undefined ? {} : { timeZone }
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', ...zone })
  const moment = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...zone,
  })
  const numbers = new Intl.NumberFormat(locale)
  const distance = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  return {
    date: (value) => day.format(value),
    dateTime: (value) => moment.format(value),
    number: (value) => numbers.format(value),
    relative: (value, now = new Date()) => {
      const seconds = (value.getTime() - now.getTime()) / 1000
      const [unit, length] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1]

      // Whole units only, toward zero, so a moment just before and just after now read alike.
      return distance.format(Math.trunc(seconds / length), unit)
    },
  }
}
