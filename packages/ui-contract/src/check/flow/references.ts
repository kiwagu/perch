/**
 * What a state of a flow names of the contract: each event is a declared anchor (a derived
 * one through its base's `derived`) or a platform event of `platform.events`; a `show` names
 * a declared anchor and codes it carries, a `navigate` the path of a binding and search
 * parameters of that binding; an address is a binding of the flow's own screen (its first
 * one when the path is left out) with search parameters of that binding.
 */

import type { Binding, Effect, FlowState, Problem } from '../../files'
import { has, PLATFORM_ACTION } from '../contract'
import { routeProblems } from '../lookups'

import type { At, InFlow } from './in-flow'

/** A platform event is named as a platform action is: `platform.<name>`. */
const PLATFORM_EVENT = PLATFORM_ACTION

const searchProblems = (
  { inScreens }: InFlow,
  binding: Binding,
  search: Readonly<Record<string, unknown>> | undefined,
  at: At,
): Problem[] =>
  Object.keys(search ?? {})
    .filter((key) => !has(binding.search?.properties ?? {}, key))
    .map((key) =>
      inScreens([...at, key], `"${key}" is not a search parameter of "${binding.path}"`),
    )

export function effectProblems(
  inFlow: InFlow,
  effects: readonly Effect[] | undefined,
  at: At,
): Problem[] {
  const { inScreens } = inFlow

  return (effects ?? []).flatMap((effect, index) => {
    const params = [...at, index, 'params']

    if (effect.type === 'navigate') {
      const { to, search } = effect.params
      const binding = inFlow.bindings.get(to)

      return binding === undefined
        ? routeProblems(inFlow, to, [...params, 'to'])
        : searchProblems(inFlow, binding, search, [...params, 'search'])
    }

    const { anchor, codes } = effect.params
    const def = inFlow.defs.get(anchor)

    if (def === undefined) {
      return [inScreens([...params, 'anchor'], `"${anchor}" is not a declared anchor`)]
    }

    return codes.flatMap((code, number) =>
      (def.codes ?? []).includes(code)
        ? []
        : [inScreens([...params, 'codes', number], `"${anchor}" carries no code "${code}"`)],
    )
  })
}

export function eventProblems(inFlow: InFlow, event: string, at: At): Problem[] {
  const { contract, known, inScreens } = inFlow

  if (event.startsWith(PLATFORM_EVENT)) {
    return has(contract.screens.platform.events ?? {}, event.slice(PLATFORM_EVENT.length))
      ? []
      : [inScreens(at, `"${event}" is not an event of platform.events`)]
  }

  return known(event) ? [] : [inScreens(at, `"${event}" is not a declared anchor`)]
}

export function addressProblems(
  inFlow: InFlow,
  address: NonNullable<FlowState['meta']>['address'],
  at: At,
): Problem[] {
  if (address === undefined) {
    return []
  }

  const { path, search } = address
  const { bindings } = inFlow.screen
  const binding =
    path === undefined ? bindings[0] : bindings.find((candidate) => candidate.path === path)

  if (binding === undefined) {
    return path === undefined
      ? [inFlow.inScreens([...at, 'search'], 'the screen has no binding')]
      : [inFlow.inScreens([...at, 'path'], `"${path}" is the path of no binding of the screen`)]
  }

  return searchProblems(inFlow, binding, search, [...at, 'search'])
}
