/**
 * Whether a field anchor holds input: what is typed into it stays until an action takes it,
 * so a leave with it typed loses it. Every field kind holds input, except a field whose own
 * change runs its action: one of its bindings runs an action that takes the field itself as a
 * parameter, and no other anchor of its screen (a submit button) runs that action with the
 * field (the language select, the organisation select), so a choice applies at once. A field
 * that binds the action a button submits it with holds input like any other.
 * Derived when the file leaves `holdsInput` out; a written value wins.
 */

import { FIELD_KINDS } from '../../anchors'
import { entriesOf, isRecord, listOf, recordOf } from '../../records'

/** The actions the anchor's bindings run with `field` among their parameters. */
const actionsTaking = (field: string, def: unknown): string[] =>
  listOf(recordOf(def)['binding'])
    .filter(isRecord)
    .flatMap((ref) =>
      typeof ref['action'] === 'string' && Object.values(recordOf(ref['params'])).includes(field)
        ? [ref['action']]
        : [],
    )

/** Whether the field runs an action with itself that no other anchor runs with it. */
const runsItself = (field: string, anchors: Readonly<Record<string, unknown>>): boolean => {
  const others = new Set(
    entriesOf(anchors)
      .filter(([name]) => name !== field)
      .flatMap(([, def]) => actionsTaking(field, def)),
  )

  return actionsTaking(field, anchors[field]).some((action) => !others.has(action))
}

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
          ? [name, { ...def, holdsInput: !runsItself(name, anchors) }]
          : [name, def],
      ),
    ),
  }
}
