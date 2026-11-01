import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'

/**
 * What this device knows of the account's stored language, to tell a language another device
 * stored from this device's own write coming back: the stored language as this device last
 * saw it, and the languages it stored that have not arrived back yet, oldest first. A write is
 * known by its language alone: another device's language equal to one this device wrote and has
 * not seen arrive yet is taken for this device's own. The window is the time this device's write
 * takes through its local database; closing it would need the write's origin in the settings.
 * A value: each step returns the next one.
 */
export class LocaleWrites {
  /** Another account, or none: nothing is known of its stored language. */
  static readonly none = new LocaleWrites(undefined, [])

  private constructor(
    readonly seen: string | undefined,
    readonly written: readonly string[],
  ) {}

  /** The stored language when this device neither stored it nor has seen it yet: the app speaks it. */
  elsewhere(stored: string): Locale | undefined {
    const locale = SUPPORTED_LOCALES.find((supported) => supported === stored)

    return locale !== undefined && stored !== this.seen && !this.written.includes(stored)
      ? locale
      : undefined
  }

  /**
   * The stored language arrived: a write of this device that came back is no longer on its way,
   * nor are the ones before it, and another device's language overtakes them all.
   */
  arrived(stored: string): LocaleWrites {
    if (stored === this.seen) {
      return this
    }

    const own = this.written.indexOf(stored)

    return new LocaleWrites(stored, own < 0 ? [] : this.written.slice(own + 1))
  }

  /** This device stores a language. */
  writing(locale: Locale): LocaleWrites {
    return new LocaleWrites(this.seen, [...this.written, locale])
  }

  /** A store failed: its language is not on its way. */
  failed(locale: Locale): LocaleWrites {
    const at = this.written.lastIndexOf(locale)

    return at < 0
      ? this
      : new LocaleWrites(this.seen, [...this.written.slice(0, at), ...this.written.slice(at + 1)])
  }
}
