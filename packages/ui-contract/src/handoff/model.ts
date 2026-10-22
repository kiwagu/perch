/**
 * The model's side of the coverage, its first measure: per entity of the model, every field
 * and every action with the anchors bound to it (`binding: { model: entity.field }` or
 * `binding: { action: entity.action }`, alone or in a list), in the order of the screens and
 * their anchors. A member no anchor binds is unbound: a report, not a rule, since a field may
 * be internal.
 */

import type { Contract } from '../check'
import { bindingRefsOf, declaredAnchors, modelTargetOf } from '../check/contract'

/** A field or an action and the anchors bound to it, none when it is unbound. */
export interface BoundMember {
  name: string
  anchors: string[]
}

export interface ModelCoverage {
  entity: string
  fields: BoundMember[]
  actions: BoundMember[]
}

export function modelCoverage({ model, screens }: Contract): ModelCoverage[] {
  const bound = new Map<string, Set<string>>()

  for (const { anchor, def } of declaredAnchors(screens)) {
    for (const { ref } of bindingRefsOf(def)) {
      const target = modelTargetOf(ref)

      if (target !== undefined) {
        const key = `${target.kind} ${target.entity}.${target.member}`

        bound.set(key, (bound.get(key) ?? new Set()).add(anchor))
      }
    }
  }

  const members = (
    kind: 'field' | 'action',
    entity: string,
    names: readonly string[],
  ): BoundMember[] =>
    names.map((name) => ({ name, anchors: [...(bound.get(`${kind} ${entity}.${name}`) ?? [])] }))

  return Object.values(model.entities).map(({ name, fields, actions }) => ({
    entity: name,
    fields: members('field', name, Object.keys(fields)),
    actions: members('action', name, Object.keys(actions)),
  }))
}
