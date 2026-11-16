/**
 * The value a field takes: the loosest of the values of its model binding and of every action
 * parameter that takes it, as the loaded screen binds them (its own action bindings, and each
 * binding of another anchor, a submit button with its derived params among them, that passes it),
 * so a field one form uses for two parameters accepts what either accepts. A `{ search }` binding
 * adds nothing, neither narrowing nor widening: the limit of a search parameter belongs to the
 * address. An anchor that is no field, and a field with no such binding, take no value.
 */

import { FIELD_KINDS } from '../../anchors'
import type { Model } from '../model'
import type { AnchorBinding, BindingRef, Platform, Screen } from '../screens'

import type { ResolvedValue } from './keywords'
import { loosest } from './loosest'
import { parameterValueOf, resolveValue } from './resolve'

/** The refs of an anchor's binding, one or a list, as a list. */
const refsOf = (binding: AnchorBinding | undefined): readonly BindingRef[] =>
  binding === undefined ? [] : Array.isArray(binding) ? binding : [binding]

export function fieldValueOf(
  anchor: string,
  screen: Screen,
  platform: Platform,
  model: Model | undefined,
): ResolvedValue | undefined {
  const def = Object.hasOwn(screen.anchors, anchor) ? screen.anchors[anchor] : undefined

  if (def === undefined || !FIELD_KINDS.has(def.kind)) {
    return undefined
  }

  const own = refsOf(def.binding).flatMap((ref) => {
    const value = 'model' in ref ? resolveValue(ref.model, platform, model) : undefined

    return value === undefined ? [] : [value]
  })
  const passed = Object.values(screen.anchors).flatMap(({ binding }) =>
    refsOf(binding).flatMap((ref) =>
      'action' in ref
        ? Object.entries(ref.params ?? {}).flatMap(([param, value]) =>
            value === anchor ? [parameterValueOf(ref.action, param, platform, model)] : [],
          )
        : [],
    ),
  )
  const values = [...own, ...passed]

  return values.length === 0 ? undefined : loosest(values)
}
