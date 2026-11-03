import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'

/**
 * What this tab knows of one setting the account stores, to tell a value another tab or device
 * stored from this tab's own write coming back: the stored value as this tab last saw it, and the
 * values it stored that have not arrived back yet, oldest first. A write is known by its value
 * alone: another tab's or device's value equal to one this tab wrote and has not seen arrive yet
 * is taken for this tab's own. The window is the time this tab's write takes through its local
 * database; closing it would need the write's origin in the settings. A value: each step returns
 * the next one.
 */
export class SettingWrites<T extends string> {
  /** Another account, or none: nothing is known of its stored value, one of `values`. */
  static none<T extends string>(values: readonly T[]): SettingWrites<T> {
    return new SettingWrites(values, undefined, [])
  }

  private constructor(
    private readonly values: readonly T[],
    readonly seen: string | undefined,
    readonly written: readonly string[],
  ) {}

  /** The stored value when this tab neither stored it nor has seen it yet: the app applies it. */
  elsewhere(stored: string): T | undefined {
    const value = this.values.find((known) => known === stored)

    return value !== undefined && stored !== this.seen && !this.written.includes(stored)
      ? value
      : undefined
  }

  /**
   * The stored value arrived: a write of this tab that came back is no longer on its way, nor are
   * the ones before it, and another tab's or device's value overtakes them all.
   */
  arrived(stored: string): SettingWrites<T> {
    if (stored === this.seen) {
      return this
    }

    const own = this.written.indexOf(stored)

    return new SettingWrites(this.values, stored, own < 0 ? [] : this.written.slice(own + 1))
  }

  /** This tab stores a value. */
  writing(value: T): SettingWrites<T> {
    return new SettingWrites(this.values, this.seen, [...this.written, value])
  }

  /** A store failed: its value is not on its way. */
  failed(value: T): SettingWrites<T> {
    const at = this.written.lastIndexOf(value)

    return at < 0
      ? this
      : new SettingWrites(this.values, this.seen, [
          ...this.written.slice(0, at),
          ...this.written.slice(at + 1),
        ])
  }
}

/** What this tab knows of each setting of the account the frame follows. */
export interface FrameWrites {
  readonly locale: SettingWrites<Locale>
}

/** Another account, or none: nothing is known of its settings. */
export const NOTHING_SEEN: FrameWrites = {
  locale: SettingWrites.none(SUPPORTED_LOCALES),
}
