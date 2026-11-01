/**
 * What a state of a flow names of the contract: each event is a declared anchor (a derived
 * one through its base's `derived`, never a visibility-button, which is presentation only), a
 * platform event of `platform.events`, or a data event
 * `model.<entity>.<field>` of a field of the model an anchor of the screen shows; a `show` names
 * a declared anchor and codes it carries, a `clear` a field of the flow's own screen, which it
 * empties (a secret one included), or a declared anchor that carries codes, which then shows
 * none (never a visibility-button, nor any other anchor), a `navigate` the path of a binding
 * and search parameters of that binding, each a literal or the value a field of the flow's own
 * screen holds (`{ anchor }`, never a visibility-button nor a secret field, which would put a
 * password into an address and its history); an address is a binding of the flow's own screen
 * (its first one when the path is left out) with search parameters of that binding.
 */

import { FIELD_KINDS, VISIBILITY_BUTTON } from '../../anchors'
import type { Binding, Effect, FlowState, Problem } from '../../files'
import {
  bindingRefsOf,
  fieldProblem,
  has,
  own,
  PLATFORM_ACTION,
  presentationOnly,
} from '../contract'
import { routeProblems } from '../lookups'

import type { At, InFlow } from './in-flow'

/** A platform event is named as a platform action is: `platform.<name>`. */
const PLATFORM_EVENT = PLATFORM_ACTION

/** A data event names a field of the model: `model.<entity>.<field>`. */
export const MODEL_EVENT = 'model.'

/** Whether an anchor of the flow's own screen shows the field: a data event needs one. */
const showsField = ({ screen }: InFlow, path: string): boolean =>
  Object.values(screen.anchors).some((def) =>
    bindingRefsOf(def).some(({ ref }) => 'model' in ref && ref.model === path),
  )

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

type NavigateSearch = Extract<Effect, { type: 'navigate' }>['params']['search']

/** The values a navigate's search takes from a field: each a field the flow's own screen declares. */
const carriedProblems = (
  { screen, visibilityButtons, inScreens }: InFlow,
  search: NavigateSearch,
  at: At,
): Problem[] =>
  Object.entries(search ?? {}).flatMap(([key, value]) => {
    if (typeof value !== 'object') {
      return []
    }

    const { anchor } = value
    const where = [...at, key, 'anchor']
    const def = own(screen.anchors, anchor)

    if (visibilityButtons.has(anchor)) {
      return [inScreens(where, presentationOnly(anchor, 'a value a search carries'))]
    }

    if (def === undefined) {
      return [inScreens(where, `"${anchor}" is not a declared anchor of the screen`)]
    }

    if (!FIELD_KINDS.has(def.kind)) {
      return [
        inScreens(
          where,
          `"${anchor}" is a ${def.kind}, not a field: a search takes the value a field holds`,
        ),
      ]
    }

    return def.secret === true
      ? [inScreens(where, `"${anchor}" is a secret field: never a value a search carries`)]
      : []
  })

/** What a clear may name: each problem of a clear that names something else says it. */
const CLEAR_NAMES =
  'a clear names a field, which it empties, or an anchor that carries codes, which then shows none'

/**
 * The anchor a clear names: a field of the flow's own screen, emptied (a secret one included),
 * or a declared anchor that carries codes, which shows none until one is shown again.
 */
function clearProblems(
  { screen, defs, visibilityButtons, inScreens }: InFlow,
  anchor: string,
  at: At,
): Problem[] {
  if (visibilityButtons.has(anchor)) {
    return [
      inScreens(at, `"${anchor}" is a ${VISIBILITY_BUTTON}, presentation only: ${CLEAR_NAMES}`),
    ]
  }

  const def = defs.get(anchor)

  if (def === undefined) {
    return [inScreens(at, `"${anchor}" is not a declared anchor`)]
  }

  if (FIELD_KINDS.has(def.kind)) {
    return own(screen.anchors, anchor) === undefined
      ? [
          inScreens(
            at,
            `"${anchor}" is a field of another screen: a clear empties a field of the flow's own screen`,
          ),
        ]
      : []
  }

  return (def.codes ?? []).length > 0
    ? []
    : [inScreens(at, `"${anchor}" is no field and carries no code: ${CLEAR_NAMES}`)]
}

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

      return [
        ...(binding === undefined
          ? routeProblems(inFlow, to, [...params, 'to'])
          : searchProblems(inFlow, binding, search, [...params, 'search'])),
        ...carriedProblems(inFlow, search, [...params, 'search']),
      ]
    }

    if (effect.type === 'clear') {
      return clearProblems(inFlow, effect.params.anchor, [...params, 'anchor'])
    }

    const { anchor } = effect.params
    const def = inFlow.defs.get(anchor)

    if (def === undefined) {
      return [inScreens([...params, 'anchor'], `"${anchor}" is not a declared anchor`)]
    }

    return effect.params.codes.flatMap((code, number) =>
      (def.codes ?? []).includes(code)
        ? []
        : [inScreens([...params, 'codes', number], `"${anchor}" carries no code "${code}"`)],
    )
  })
}

export function eventProblems(inFlow: InFlow, event: string, at: At): Problem[] {
  const { contract, known, visibilityButtons, inScreens } = inFlow

  if (visibilityButtons.has(event)) {
    return [inScreens(at, presentationOnly(event, 'an event of a flow'))]
  }

  if (event.startsWith(MODEL_EVENT)) {
    const path = event.slice(MODEL_EVENT.length)
    const problem = fieldProblem(contract.model, path)

    if (problem !== undefined) {
      return [inScreens(at, problem)]
    }

    return showsField(inFlow, path)
      ? []
      : [inScreens(at, `"${event}": no anchor of the screen shows ${path}`)]
  }

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
