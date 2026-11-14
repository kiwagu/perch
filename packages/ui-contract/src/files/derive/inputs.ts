/**
 * Whether a field anchor holds input: what is typed into it stays until an action takes it, so a
 * leave with it typed loses it. Every field kind holds input, except a field whose own change
 * applies it at once, and nothing else applies it:
 *
 * 1. one of its bindings runs an action that takes the field itself as a parameter, and no other
 *    anchor of its screen (a submit button) runs that action with the field (the language select,
 *    the organisation select); a field that binds the action a button submits it with holds input
 *    like any other;
 * 2. its own event moves its screen's search with it: a branch of the event has a `navigate` to a
 *    path of its screen whose `search` takes the field, and no other anchor's event has one that
 *    does (a filter applied on change). A search box a search button carries holds input; so does
 *    a field that moves to another screen carrying itself, which leaves rather than moves the
 *    search, and a field whose move leaves it out of the search.
 *
 * Derived on the parsed screen, since rule 2 reads its flow, when the file leaves `holdsInput`
 * out; a written value wins. The frame has no path and moves no search: it derives rule 1 alone.
 */

import { FIELD_KINDS } from '../../anchors'
import type { AnchorDef, BindingRef, Screen } from '../screens'

import { carriedBy, controlMovesOf, ownPathsOf } from './leaves'

/** The refs of an anchor's binding, one or a list. */
const refsOf = (def: AnchorDef): BindingRef[] => {
  const { binding } = def

  if (binding === undefined) {
    return []
  }

  return Array.isArray(binding) ? binding : [binding]
}

/** The actions the anchor's bindings run with `field` among their parameters. */
const actionsTaking = (field: string, def: AnchorDef): string[] =>
  refsOf(def).flatMap((ref) =>
    'action' in ref && Object.values(ref.params ?? {}).includes(field) ? [ref.action] : [],
  )

/** Whether the field runs an action with itself that no other anchor of the screen runs with it. */
const runsItself = (field: string, def: AnchorDef, anchors: Screen['anchors']): boolean => {
  const others = new Set(
    Object.entries(anchors)
      .filter(([name]) => name !== field)
      .flatMap(([, other]) => actionsTaking(field, other)),
  )

  return actionsTaking(field, def).some((action) => !others.has(action))
}

/** The controls whose event moves the screen's search with a field, by field. */
const searchMoversOf = (screen: Screen): Map<string, Set<string>> => {
  const paths = ownPathsOf(screen)
  const movers = new Map<string, Set<string>>()

  for (const { control, navigates } of controlMovesOf(screen)) {
    for (const navigate of navigates.filter(({ params }) => paths.has(params.to))) {
      for (const field of carriedBy(navigate)) {
        movers.set(field, new Set([...(movers.get(field) ?? []), control]))
      }
    }
  }

  return movers
}

/** `screen` with `holdsInput` on each field anchor whose file leaves it out. */
export function withDerivedInputs(screen: Screen): Screen {
  const movers = searchMoversOf(screen)

  /** Whether the field's own event moves the search with it, and no other control's does. */
  const movesItself = (field: string): boolean => {
    const movedBy = movers.get(field)

    return movedBy !== undefined && movedBy.size === 1 && movedBy.has(field)
  }

  return {
    ...screen,
    anchors: Object.fromEntries(
      Object.entries(screen.anchors).map(([name, def]) => [
        name,
        FIELD_KINDS.has(def.kind) && def.holdsInput === undefined
          ? { ...def, holdsInput: !(runsItself(name, def, screen.anchors) || movesItself(name)) }
          : def,
      ]),
    ),
  }
}
