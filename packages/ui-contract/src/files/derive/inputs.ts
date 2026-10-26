/**
 * Whether a field anchor holds input: what is typed into it stays until an action takes it,
 * so a leave with it typed loses it. Every field kind holds input, except a field whose own
 * change runs its action: one of its bindings runs an action that takes the field itself as a
 * parameter (the language select, the organisation select), so a choice applies at once.
 * Derived when the file leaves `holdsInput` out; a written value wins.
 */

import { FIELD_KINDS } from '../../anchors'
import { entriesOf, isRecord, listOf, recordOf } from '../../records'

/** Whether a binding of the anchor runs an action that takes the anchor itself as a parameter. */
const runsItself = (anchor: string, def: Readonly<Record<string, unknown>>): boolean =>
  listOf(def['binding'])
    .filter(isRecord)
    .some(
      (ref) =>
        typeof ref['action'] === 'string' &&
        Object.values(recordOf(ref['params'])).includes(anchor),
    )

const isField = (def: Readonly<Record<string, unknown>>): boolean =>
  typeof def['kind'] === 'string' && FIELD_KINDS.has(def['kind'])

/** `screen` as read, each field anchor with `holdsInput` when the file leaves it out. */
export function withDerivedInputs(screen: unknown): unknown {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return screen
  }

  return {
    ...screen,
    anchors: Object.fromEntries(
      entriesOf(anchors).map(([name, def]) =>
        isRecord(def) && isField(def) && def['holdsInput'] === undefined
          ? [name, { ...def, holdsInput: !runsItself(name, def) }]
          : [name, def],
      ),
    ),
  }
}
