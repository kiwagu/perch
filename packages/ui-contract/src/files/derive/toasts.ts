/**
 * The codes of the frame's toast anchor, derived when the frame writes none: every code a flow
 * shows on it, derived from a model action's success or written (a warning of its own), each
 * once, in the order the screen files are read. The vocabulary lists the derived ones by one rule
 * row, keyed `TOAST_RULE_ROW`; a written one has its own row.
 */

import { isRecord, recordOf } from '../../records'

/** The key of the vocabulary's row that stands for every derived toast code. */
export const TOAST_RULE_ROW = '<object>-<verb>ed'

function shownOn(node: unknown, anchor: string, into: string[]): void {
  if (Array.isArray(node)) {
    for (const each of node) {
      shownOn(each, anchor, into)
    }

    return
  }

  if (!isRecord(node)) {
    return
  }

  const params = recordOf(node['params'])
  const codes = params['codes']

  if (node['type'] === 'show' && params['anchor'] === anchor && Array.isArray(codes)) {
    for (const code of codes) {
      if (typeof code === 'string' && !into.includes(code)) {
        into.push(code)
      }
    }
  }

  for (const value of Object.values(node)) {
    shownOn(value, anchor, into)
  }
}

/** The codes the expanded `flows` show on `anchor`. */
export function toastCodesOf(flows: readonly unknown[], anchor: string): string[] {
  const codes: string[] = []

  shownOn(flows, anchor, codes)

  return codes
}

/** `screen` as read, its anchor `anchor` carrying `codes` unless it writes its own. */
export function withToastCodes(screen: unknown, anchor: string, codes: readonly string[]): unknown {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined
  const def = isRecord(anchors) ? anchors[anchor] : undefined

  if (
    !isRecord(screen) ||
    !isRecord(anchors) ||
    !isRecord(def) ||
    def['codes'] !== undefined ||
    codes.length === 0
  ) {
    return screen
  }

  return { ...screen, anchors: { ...anchors, [anchor]: { ...def, codes: [...codes] } } }
}
