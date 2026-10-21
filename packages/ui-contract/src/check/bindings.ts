/**
 * Rule 3: what anchors and flow events are bound to exists. `model: entity.field` names a
 * field of an entity of the model; `action` names an entity action or a platform action,
 * and its `params` keys are that action's parameters, each taking a declared anchor or a
 * constant (a parameter left out is the view's to compute, and `$id` is minted); `route`
 * is the path of a binding; a `source` names an entity and its order field, or a platform
 * action.
 */

import type { AnchorDef, BindingRef, Problem } from '../files'

import { bindingPaths, type Contract, declaredAnchors, inScreens, knownAnchors } from './contract'

type Params = Extract<BindingRef, { action: string }>['params']

const PLATFORM = 'platform.'

/** The parameters of an action, or the problem that it does not exist. */
function parametersOf(
  { model, screens }: Contract,
  action: string,
): { parameters?: readonly string[]; problem?: string } {
  if (action.startsWith(PLATFORM)) {
    const name = action.slice(PLATFORM.length)
    const platform = screens.platform.actions[name]

    return platform === undefined
      ? { problem: `no platform action "${name}"` }
      : { parameters: Object.keys(platform.params) }
  }

  const [entityName = '', actionName = ''] = action.split('.')
  const entity = model.entities[entityName]
  const found = entity?.actions[actionName]

  if (entity === undefined) {
    return { problem: `no entity "${entityName}" in the model` }
  }

  return found === undefined
    ? { problem: `entity "${entityName}" has no action "${actionName}"` }
    : { parameters: Object.keys(found.params) }
}

/** The contract with the lookups every binding needs, built once. */
interface Lookups {
  readonly contract: Contract
  readonly known: (anchor: string) => boolean
  readonly paths: ReadonlySet<string>
}

function actionProblems(
  { contract, known }: Lookups,
  action: string,
  params: Params,
  at: readonly PropertyKey[],
): Problem[] {
  const { parameters, problem } = parametersOf(contract, action)

  if (parameters === undefined) {
    return [inScreens([...at, 'action'], problem ?? '')]
  }

  return Object.entries(params ?? {}).flatMap(([key, value]) => [
    ...(parameters.includes(key)
      ? []
      : [inScreens([...at, 'params', key], `"${key}" is not a parameter of "${action}"`)]),
    ...(typeof value !== 'string' || known(value)
      ? []
      : [inScreens([...at, 'params', key], `"${value}" is not a declared anchor`)]),
  ])
}

const routeProblems = (
  paths: ReadonlySet<string>,
  route: string | undefined,
  at: readonly PropertyKey[],
): Problem[] =>
  route === undefined || paths.has(route)
    ? []
    : [inScreens(at, `"${route}" is the path of no binding`)]

function bindingProblems(lookups: Lookups, ref: BindingRef, at: readonly PropertyKey[]): Problem[] {
  if ('route' in ref) {
    return routeProblems(lookups.paths, ref.route, [...at, 'route'])
  }

  if ('action' in ref) {
    return actionProblems(lookups, ref.action, ref.params, at)
  }

  const [entityName = '', field = ''] = ref.model.split('.')
  const entity = lookups.contract.model.entities[entityName]

  if (entity === undefined) {
    return [inScreens([...at, 'model'], `no entity "${entityName}" in the model`)]
  }

  return field in entity.fields
    ? []
    : [inScreens([...at, 'model'], `entity "${entityName}" has no field "${field}"`)]
}

function sourceProblems(contract: Contract, def: AnchorDef, at: readonly PropertyKey[]): Problem[] {
  const { source } = def

  if (source === undefined) {
    return []
  }

  if ('platform' in source) {
    return source.platform in contract.screens.platform.actions
      ? []
      : [inScreens([...at, 'platform'], `no platform action "${source.platform}"`)]
  }

  const entity = contract.model.entities[source.entity]

  if (entity === undefined) {
    return [inScreens([...at, 'entity'], `no entity "${source.entity}" in the model`)]
  }

  return source.order === undefined || source.order in entity.fields
    ? []
    : [inScreens([...at, 'order'], `entity "${source.entity}" has no field "${source.order}"`)]
}

function anchorProblems(lookups: Lookups): Problem[] {
  return declaredAnchors(lookups.contract.screens).flatMap(({ def, at }) => {
    const binding = def.binding
    const refs =
      binding === undefined
        ? []
        : Array.isArray(binding)
          ? binding.map((ref, index) => ({ ref, at: [...at, 'binding', index] }))
          : [{ ref: binding, at: [...at, 'binding'] }]

    return [
      ...refs.flatMap((entry) => bindingProblems(lookups, entry.ref, entry.at)),
      ...sourceProblems(lookups.contract, def, [...at, 'source']),
    ]
  })
}

function flowProblems(lookups: Lookups): Problem[] {
  const { known, paths } = lookups

  return lookups.contract.screens.screens.flatMap((screen, index) =>
    (screen.flow?.events ?? []).flatMap((event, number) => {
      const at = ['screens', index, 'flow', 'events', number]

      return [
        ...(known(event.on)
          ? []
          : [inScreens([...at, 'on'], `"${event.on}" is not a declared anchor`)]),
        ...(event.action === undefined
          ? []
          : actionProblems(lookups, event.action, event.params, at)),
        ...(['success', 'failure'] as const).flatMap((outcome) =>
          routeProblems(paths, event.outcomes[outcome]?.route, [
            ...at,
            'outcomes',
            outcome,
            'route',
          ]),
        ),
      ]
    }),
  )
}

export function bindingsProblems(contract: Contract): Problem[] {
  const lookups: Lookups = {
    contract,
    known: knownAnchors(contract),
    paths: bindingPaths(contract.screens),
  }

  return [...anchorProblems(lookups), ...flowProblems(lookups)]
}
