/**
 * The default length of a value. From version 6 the platform may declare one,
 * `defaults: { maxLength }`, which a value that names no limit takes: a string (`type: string`),
 * no `enum`, not read-only, whose `maxLength` is not written. A value that writes its own
 * `maxLength` keeps it, and one that writes `maxLength: null` has no limit and takes none, so the
 * value every reader takes has a number or no `maxLength` at all. A written limit the default
 * would give back is the default's (`givesBack`).
 */

import type { PlatformDefaults } from '../../schemas'

/** The version from which a value that names no limit takes the platform's default length. */
export const DEFAULTS_EDITION = 6

/** What of a value decides whether it takes the default length. */
interface Lengthed {
  readonly type?: unknown
  readonly enum?: unknown
  readonly maxLength?: number | null | undefined
}

/** A value with its length resolved: a number or none. */
export type WithLength<V extends Lengthed> = Omit<V, 'maxLength'> & { maxLength?: number }

/** Whether `value`, written without a `maxLength`, would take the default length. */
export const takesDefault = (value: Lengthed, readOnly: boolean): boolean =>
  value.type === 'string' && value.enum === undefined && !readOnly

/**
 * Whether the `maxLength` `value` writes is the one the default would give it, written or not:
 * the default's number, on a value that would take it.
 */
export const givesBack = (
  value: Lengthed,
  defaults: PlatformDefaults | undefined,
  readOnly: boolean,
): boolean =>
  defaults !== undefined && value.maxLength === defaults.maxLength && takesDefault(value, readOnly)

/**
 * `value` with its length resolved by `defaults`, `readOnly` when the value is read-only: its own
 * number kept, a `null` left out, the default taken where it names none and would take it.
 */
export function withDefaultLength<V extends Lengthed>(
  value: V,
  defaults: PlatformDefaults | undefined,
  readOnly = false,
): WithLength<V> {
  const { maxLength, ...rest } = value

  if (typeof maxLength === 'number') {
    return { ...value, maxLength }
  }

  return maxLength === undefined && defaults !== undefined && takesDefault(value, readOnly)
    ? { ...rest, maxLength: defaults.maxLength }
    : rest
}
