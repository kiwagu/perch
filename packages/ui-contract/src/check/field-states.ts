/**
 * The states a field carries about its input. A field of a stateful kind that holds input is
 * `unsaved` while it holds what is not saved yet, and `saved` when it also shows a stored value
 * (it is bound to a model field). A state counts only when the vocabulary declares it.
 */

import { FIELD_STATES, type FieldState, STATEFUL_FIELD_KINDS } from '../anchors'
import type { AnchorDef, Vocabulary } from '../files'

import { bindingRefsOf } from './contract'

/** Whether the field shows a value stored in the model: a stateful field holding input, bound to a model field. */
export function showsStoredValue(def: AnchorDef): boolean {
  return (
    STATEFUL_FIELD_KINDS.has(def.kind) &&
    def.holdsInput === true &&
    bindingRefsOf(def).some(({ ref }) => 'model' in ref)
  )
}

/** The field states `def` carries, in the order of `FIELD_STATES`; none when it is not a tracked field. */
export function fieldStatesOf(def: AnchorDef, vocabulary: Vocabulary): readonly FieldState[] {
  if (!STATEFUL_FIELD_KINDS.has(def.kind) || def.holdsInput !== true) {
    return []
  }

  const stored = showsStoredValue(def)

  return FIELD_STATES.filter(
    (state) => state in vocabulary.fieldStates && (state === 'unsaved' || stored),
  )
}
