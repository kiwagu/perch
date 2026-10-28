/**
 * What the expansion of each flow reads of every screen file as read: the codes each anchor
 * carries, the frame's toast anchor, and whether the frame writes that anchor's codes itself.
 */

import { isRecord, recordOf } from '../../records'
import type { FailureOf } from '../derive'
import type { CodesOf } from '../expand-flow'

/** What the expansion of every flow reads of all the screens as read. */
export interface Lookups {
  readonly codesOf: CodesOf
  readonly failureOf: FailureOf
  readonly toast: string | undefined
  readonly platformToasts: Readonly<Record<string, string>>
}

/** The codes each anchor of the screens as read carries, for `show: <anchor>`. */
export function codesOfRead(read: readonly unknown[]): CodesOf {
  const codes = new Map<string, readonly string[]>()

  for (const screen of read) {
    const anchors = isRecord(screen) ? screen['anchors'] : undefined

    for (const [anchor, definition] of isRecord(anchors) ? Object.entries(anchors) : []) {
      const declared = isRecord(definition) ? definition['codes'] : undefined

      codes.set(
        anchor,
        Array.isArray(declared)
          ? declared.filter((code: unknown): code is string => typeof code === 'string')
          : [],
      )
    }
  }

  return (anchor) => codes.get(anchor)
}

/** The frame's toast anchor as read: the anchor of kind `toast` of the screen marked `frame`. */
export function toastOfRead(read: readonly unknown[]): string | undefined {
  for (const screen of read) {
    if (isRecord(screen) && screen['frame'] === true && isRecord(screen['anchors'])) {
      const found = Object.entries(screen['anchors']).find(
        ([, def]) => isRecord(def) && def['kind'] === 'toast',
      )

      if (found !== undefined) {
        return found[0]
      }
    }
  }

  return undefined
}

/** Whether the frame as read writes the codes of its toast anchor itself. */
export const writesToastCodes = (read: readonly unknown[], toast: string): boolean =>
  read.some(
    (screen) =>
      isRecord(screen) &&
      screen['frame'] === true &&
      recordOf(recordOf(screen['anchors'])[toast])['codes'] !== undefined,
  )
