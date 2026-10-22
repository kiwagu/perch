/**
 * Rule 3: what anchors are bound to exists. `model: entity.field` names a field of an
 * entity of the model; `action` names an entity action or a platform action, and its
 * `params` keys are that action's parameters, each taking a declared anchor or a constant
 * (a parameter left out is the view's to compute, and `$id` is minted); `route` is the path
 * of a binding; a `source` names an entity and its order field, or a platform action. What
 * a flow names is rule 8's (`flow.ts`).
 */

import type { AnchorDef, BindingRef, Problem } from '../files'

import { bindingRefsOf, type Contract, declaredAnchors, fieldProblem, has, own } from './contract'
import { actionProblems, type Lookups, lookupsOf, routeProblems } from './lookups'

function bindingProblems(lookups: Lookups, ref: BindingRef, at: readonly PropertyKey[]): Problem[] {
  if ('route' in ref) {
    return routeProblems(lookups, ref.route, [...at, 'route'])
  }

  if ('action' in ref) {
    return actionProblems(lookups, ref.action, ref.params, {
      action: [...at, 'action'],
      params: [...at, 'params'],
    })
  }

  const problem = fieldProblem(lookups.contract.model, ref.model)

  return problem === undefined ? [] : [lookups.inScreens([...at, 'model'], problem)]
}

function sourceProblems(
  { contract, inScreens }: Lookups,
  def: AnchorDef,
  at: readonly PropertyKey[],
): Problem[] {
  const { source } = def

  if (source === undefined) {
    return []
  }

  if ('platform' in source) {
    return has(contract.screens.platform.actions, source.platform)
      ? []
      : [inScreens([...at, 'platform'], `no platform action "${source.platform}"`)]
  }

  const entity = own(contract.model.entities, source.entity)

  if (entity === undefined) {
    return [inScreens([...at, 'entity'], `no entity "${source.entity}" in the model`)]
  }

  return source.order === undefined || has(entity.fields, source.order)
    ? []
    : [inScreens([...at, 'order'], `entity "${source.entity}" has no field "${source.order}"`)]
}

function anchorProblems(lookups: Lookups): Problem[] {
  return declaredAnchors(lookups.contract.screens).flatMap(({ def, at }) => [
    ...bindingRefsOf(def).flatMap((entry) =>
      bindingProblems(lookups, entry.ref, [...at, ...entry.at]),
    ),
    ...sourceProblems(lookups, def, [...at, 'source']),
  ])
}

export const bindingsProblems = (contract: Contract): Problem[] =>
  anchorProblems(lookupsOf(contract))
