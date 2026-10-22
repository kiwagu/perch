/**
 * What backs a transition of an activity in the screens: the flow of the anchor's screen,
 * from a transition on that anchor, reaches a `navigate` to the target's path (in the
 * transition's actions, on leaving its state or entering its target, as XState runs `exit`
 * and `entry` on a move, or after an invoke's `onDone` or `onError`, each state followed
 * once), or the anchor is a link to that path (`binding.route`).
 */

import type { AnchorDef, Effect, Flow, FlowTransition, Screen } from '../../files'
import { bindingRefsOf, own } from '../contract'

/** A transition or a guarded list of them, as a list. */
export const listOf = <T>(transitions: T | T[]): readonly T[] =>
  Array.isArray(transitions) ? transitions : [transitions]

/** The paths a flow navigates to after a transition on `anchor`, each state followed once. */
function navigatesAfter(flow: Flow, anchor: string): Set<string> {
  const paths = new Set<string>()
  const seen = new Set<string>()
  const collect = (effects: readonly Effect[] | undefined): void => {
    for (const effect of effects ?? []) {
      if (effect.type === 'navigate') {
        paths.add(effect.params.to)
      }
    }
  }
  /** Out of `from`: the actions, and on a move the exit of `from` and the target's entry. */
  const follow = (from: string, transition: FlowTransition): void => {
    const { target } = transition

    collect(transition.actions)

    if (target === undefined || target === from) {
      return
    }

    collect(own(flow.states, from)?.exit)

    const state = seen.has(target) ? undefined : own(flow.states, target)

    if (state === undefined) {
      return
    }

    seen.add(target)
    collect(state.entry)

    if (state.invoke !== undefined) {
      for (const outcome of [
        ...listOf(state.invoke.onDone),
        ...listOf(state.invoke.onError ?? []),
      ]) {
        follow(target, outcome)
      }
    }
  }

  for (const [name, state] of Object.entries(flow.states)) {
    const transitions = own(state.on ?? {}, anchor)

    for (const transition of transitions === undefined ? [] : listOf(transitions)) {
      follow(name, transition)
    }
  }

  return paths
}

/**
 * An event of the state's screen or of the frame: the anchor, the screen that declares it (or
 * its base) and its declaration, when the anchor is declared rather than derived.
 */
export interface Backing {
  readonly anchor: string
  readonly owner: Screen
  readonly def: AnchorDef | undefined
}

/** Whether the screens take acting on the anchor to `path`: a flow's navigate, or a link. */
export function backed({ anchor, owner, def }: Backing, path: string): boolean {
  const linked =
    def !== undefined && bindingRefsOf(def).some(({ ref }) => 'route' in ref && ref.route === path)

  return linked || (owner.flow !== undefined && navigatesAfter(owner.flow, anchor).has(path))
}
