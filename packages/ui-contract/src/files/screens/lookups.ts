/**
 * What the expansion of each flow reads of every screen file as read: the codes each anchor
 * carries, the frame's toast anchor, and whether the frame writes that anchor's codes itself;
 * and the frame's confirmation, which the questions before destructive actions name.
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

/** The frame's anchor of kind `kind` as read, in the screen marked `frame`. */
function frameAnchorOfRead(read: readonly unknown[], kind: string): string | undefined {
  for (const screen of read) {
    if (isRecord(screen) && screen['frame'] === true && isRecord(screen['anchors'])) {
      const found = Object.entries(screen['anchors']).find(
        ([, def]) => isRecord(def) && def['kind'] === kind,
      )

      if (found !== undefined) {
        return found[0]
      }
    }
  }

  return undefined
}

/** The frame's toast anchor as read: the anchor of kind `toast` of the screen marked `frame`. */
export const toastOfRead = (read: readonly unknown[]): string | undefined =>
  frameAnchorOfRead(read, 'toast')

/**
 * The frame's confirmation as read: the anchor of kind `confirmation` of the screen marked
 * `frame`, which asks before every destructive action.
 */
export const confirmationOfRead = (read: readonly unknown[]): string | undefined =>
  frameAnchorOfRead(read, 'confirmation')

/** Whether the frame as read writes the codes of its anchor `anchor` itself. */
export const frameWritesCodes = (read: readonly unknown[], anchor: string): boolean =>
  read.some(
    (screen) =>
      isRecord(screen) &&
      screen['frame'] === true &&
      recordOf(recordOf(screen['anchors'])[anchor])['codes'] !== undefined,
  )
