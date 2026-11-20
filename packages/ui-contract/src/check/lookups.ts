/**
 * The lookups the bindings rule and the flow rule share, built once per contract, and what
 * both hold an action and a route to: an action is an entity action or a platform action,
 * each key of its params (a binding's `params`, an invoke's `input`) one of its parameters
 * taking a declared anchor (never a visibility-button, which holds no input), a constant, or a
 * search parameter every route of the screen declares (a parameter left out is the
 * implementation's to compute, and `$id` is minted); a route is the path of a binding.
 */

import type { AnchorDef, ParamValue, Problem, Screen } from '../files'

import {
  bindingPaths,
  type Contract,
  entityMemberOf,
  type InScreens,
  knownAnchors,
  locate,
  own,
  PLATFORM_ACTION,
  presentationOnly,
  visibilityButtonsOf,
} from './contract'

export interface Lookups {
  readonly contract: Contract
  readonly known: (anchor: string) => boolean
  /** The visibility-buttons the inputs render, presentation only. */
  readonly visibilityButtons: ReadonlySet<string>
  readonly paths: ReadonlySet<string>
  readonly inScreens: InScreens
}

export const lookupsOf = (contract: Contract): Lookups => ({
  contract,
  known: knownAnchors(contract),
  visibilityButtons: visibilityButtonsOf(contract.screens),
  paths: bindingPaths(contract.screens),
  inScreens: locate(contract.screens),
})

/** The parameters of an action, or the problem that it does not exist. */
function parametersOf(
  { model, screens }: Contract,
  action: string,
): { parameters?: readonly string[]; problem?: string } {
  if (action.startsWith(PLATFORM_ACTION)) {
    const name = action.slice(PLATFORM_ACTION.length)
    const platform = own(screens.platform.actions, name)

    return platform === undefined
      ? { problem: `no platform action "${name}"` }
      : { parameters: Object.keys(platform.params) }
  }

  const { entity: entityName, member: actionName } = entityMemberOf(action)
  const entity = own(model.entities, entityName)
  const found = entity === undefined ? undefined : own(entity.actions, actionName)

  if (entity === undefined) {
    return { problem: `no entity "${entityName}" in the model` }
  }

  return found === undefined
    ? { problem: `entity "${entityName}" has no action "${actionName}"` }
    : { parameters: Object.keys(found.params) }
}

/** The search parameters every route of `screen` declares; none for the frame, which has no route. */
export function searchOf(screen: Pick<Screen, 'bindings'>): ReadonlySet<string> {
  const [first, ...rest] = screen.bindings.map(
    (binding) => new Set(Object.keys(binding.search?.properties ?? {})),
  )

  return new Set([...(first ?? [])].filter((name) => rest.every((names) => names.has(name))))
}

/** A list's platform source: the action it reads, its `params` and whether it pages. */
export type PlatformSource = Extract<NonNullable<AnchorDef['source']>, { platform: string }>

/**
 * The paged list of `screen`, the first anchor declared whose platform source says
 * `paged: true` (rule 18 refuses a second), with that source; none where no list pages.
 */
export function pagedListOf(
  screen: Pick<Screen, 'anchors'>,
): { anchor: string; source: PlatformSource } | undefined {
  for (const [anchor, { source }] of Object.entries(screen.anchors)) {
    if (source !== undefined && 'platform' in source && source.paged === true) {
      return { anchor, source }
    }
  }

  return undefined
}

/**
 * The problems of an action and its params, the action at `at.action` and each param at
 * `at.params` and its key: each param a parameter of the action, taking a declared anchor (a
 * visibility-button is presentation only and gives no value), a constant, or a search parameter
 * of `search`.
 */
export function actionProblems(
  { contract, known, visibilityButtons, inScreens }: Lookups,
  action: string,
  params: Readonly<Record<string, ParamValue>> | undefined,
  at: { readonly action: readonly PropertyKey[]; readonly params: readonly PropertyKey[] },
  search: ReadonlySet<string> = new Set(),
): Problem[] {
  const { parameters, problem } = parametersOf(contract, action)

  if (parameters === undefined) {
    return [inScreens(at.action, problem ?? '')]
  }

  return Object.entries(params ?? {}).flatMap(([key, value]) => [
    ...(parameters.includes(key)
      ? []
      : [inScreens([...at.params, key], `"${key}" is not a parameter of "${action}"`)]),
    ...(typeof value !== 'string' || known(value)
      ? []
      : [inScreens([...at.params, key], `"${value}" is not a declared anchor`)]),
    ...(typeof value === 'string' && visibilityButtons.has(value)
      ? [inScreens([...at.params, key], presentationOnly(value, 'a value an action takes'))]
      : []),
    ...(typeof value === 'object' && 'search' in value && !search.has(value.search)
      ? [
          inScreens(
            [...at.params, key],
            `"${value.search}" is not a search parameter of every route of the screen`,
          ),
        ]
      : []),
  ])
}

export const routeProblems = (
  { paths, inScreens }: Lookups,
  route: string | undefined,
  at: readonly PropertyKey[],
): Problem[] =>
  route === undefined || paths.has(route)
    ? []
    : [inScreens(at, `"${route}" is the path of no binding`)]
