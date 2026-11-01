/**
 * Rule 9: an activity agrees with the screens it visits. Its roles are of the vocabulary and
 * what it carries names fields of the model; its `initial` and every `target` are states of
 * it; each state is a visit to a screen that exists (`meta.screen`) at the path of a binding
 * of that screen (`meta.address.path`); every event is a declared anchor (a derived one
 * through its base's `derived`, never a visibility-button, which is presentation only) of that
 * screen or of the frame. Every transition is backed by
 * the screens (`backing.ts`): the flow of the anchor's screen (the frame's for a frame
 * anchor) navigates to the target's path after a transition on that anchor, or the anchor is
 * a link to that path. Every guard is
 * declared in `meta.guards` and every declared one is used; every state is reachable from
 * `initial`, and every state that is not final has a transition to leave it. Each problem is
 * named by its JSON path in the activity's file, at the line of the deepest part of that path
 * the file holds.
 */

import { baseOf } from '../../anchors'
import {
  type Activity,
  type ActivityState,
  type ActivityTransition,
  type AnchorDef,
  activityFile,
  jsonPath,
  lineAt,
  type Problem,
  type Screen,
} from '../../files'
import {
  type Contract,
  declaredAnchors,
  fieldProblem,
  has,
  inFile,
  knownAnchors,
  own,
  presentationOnly,
  visibilityButtonsOf,
} from '../contract'

import { type Backing, backed, listOf } from './backing'

type At = readonly PropertyKey[]

/** One activity as the checks read it, with the lookups of the whole contract. */
interface InActivity {
  readonly activity: Activity
  readonly contract: Contract
  readonly screens: ReadonlyMap<string, Screen>
  readonly known: (anchor: string) => boolean
  /** The visibility-buttons the inputs render, presentation only. */
  readonly visibilityButtons: ReadonlySet<string>
  /** A declared anchor with its screen. */
  readonly declared: ReadonlyMap<string, { readonly def: AnchorDef; readonly screen: Screen }>
  readonly problem: (at: At, message: string) => Problem
}

/** The screen that declares an anchor, or the base of a derived one. */
function screenOf({ contract, declared }: InActivity, anchor: string): Screen | undefined {
  const base = baseOf(anchor, Object.keys(contract.vocabulary.suffixes))

  return (declared.get(anchor) ?? declared.get(base ?? ''))?.screen
}

function eventProblems(inActivity: InActivity, screen: Screen, anchor: string, at: At): Problem[] {
  if (inActivity.visibilityButtons.has(anchor)) {
    return [inActivity.problem(at, presentationOnly(anchor, 'an event of an activity'))]
  }

  if (!inActivity.known(anchor)) {
    return [inActivity.problem(at, `"${anchor}" is not a declared anchor`)]
  }

  const owner = screenOf(inActivity, anchor)

  return owner === undefined || owner.id === screen.id || owner.frame === true
    ? []
    : [
        inActivity.problem(
          at,
          `"${anchor}" is an anchor of "${owner.id}", not of "${screen.id}" or the frame`,
        ),
      ]
}

/** A transition's target and guard, and, for an event of the state's screen, what backs it. */
function transitionProblems(
  inActivity: InActivity,
  transition: ActivityTransition,
  at: At,
  backing: Backing | undefined,
): Problem[] {
  const { activity, problem } = inActivity
  const { target, guard } = transition
  const path = own(activity.states, target)?.meta.address.path

  return [
    ...(path === undefined
      ? [problem([...at, 'target'], `"${target}" is not a state of the activity`)]
      : []),
    ...(guard === undefined || has(activity.meta?.guards ?? {}, guard)
      ? []
      : [problem([...at, 'guard'], `"${guard}" is not a guard of meta.guards`)]),
    ...(backing === undefined || path === undefined || backed(backing, path)
      ? []
      : [
          problem(
            at,
            `"${backing.anchor}" leads to "${path}" through neither a navigate of the flow of "${backing.owner.id}" nor a link`,
          ),
        ]),
  ]
}

function stateProblems(inActivity: InActivity, name: string, state: ActivityState): Problem[] {
  const { problem } = inActivity
  const at = ['states', name]
  const { screen: id, address } = state.meta
  const screen = inActivity.screens.get(id)
  const located =
    screen === undefined
      ? [problem([...at, 'meta', 'screen'], `"${id}" is not a screen`)]
      : screen.bindings.some(({ path }) => path === address.path)
        ? []
        : [
            problem(
              [...at, 'meta', 'address', 'path'],
              `"${address.path}" is the path of no binding of "${screen.id}"`,
            ),
          ]

  return [
    ...located,
    ...Object.entries(state.on ?? {}).flatMap(([anchor, transitions]) => {
      const where = [...at, 'on', anchor]
      const event = screen === undefined ? [] : eventProblems(inActivity, screen, anchor, where)
      const owner =
        screen === undefined || event.length > 0 ? undefined : screenOf(inActivity, anchor)
      const backing =
        owner === undefined
          ? undefined
          : { anchor, owner, def: inActivity.declared.get(anchor)?.def }

      return [
        ...event,
        ...listOf(transitions).flatMap((transition, index) =>
          transitionProblems(
            inActivity,
            transition,
            Array.isArray(transitions) ? [...where, index] : where,
            backing,
          ),
        ),
      ]
    }),
  ]
}

const transitionsOf = (state: ActivityState): readonly ActivityTransition[] =>
  Object.values(state.on ?? {}).flatMap(listOf)

function unusedGuardProblems({ activity, problem }: InActivity): Problem[] {
  const used = new Set(
    Object.values(activity.states)
      .flatMap(transitionsOf)
      .flatMap(({ guard }) => (guard === undefined ? [] : [guard])),
  )

  return Object.keys(activity.meta?.guards ?? {})
    .filter((guard) => !used.has(guard))
    .map((guard) => problem(['meta', 'guards', guard], 'is declared but no transition uses it'))
}

function unreachableProblems({ activity, problem }: InActivity): Problem[] {
  const reached = new Set<string>()
  const next = has(activity.states, activity.initial) ? [activity.initial] : []

  for (let name = next.pop(); name !== undefined; name = next.pop()) {
    const state = reached.has(name) ? undefined : own(activity.states, name)

    reached.add(name)
    next.push(
      ...(state === undefined ? [] : transitionsOf(state))
        .map(({ target }) => target)
        .filter((target) => has(activity.states, target) && !reached.has(target)),
    )
  }

  return Object.keys(activity.states)
    .filter((name) => !reached.has(name))
    .map((name) => problem(['states', name], `is not reachable from "${activity.initial}"`))
}

const stuckProblems = ({ activity, problem }: InActivity): Problem[] =>
  Object.entries(activity.states)
    .filter(([, state]) => state.type !== 'final' && transitionsOf(state).length === 0)
    .map(([name]) => problem(['states', name], 'is not final and has no transition to leave it'))

function activityProblems(inActivity: InActivity): Problem[] {
  const { activity, contract, problem } = inActivity

  return [
    ...activity.roles.flatMap((role, index) =>
      has(contract.vocabulary.roles, role)
        ? []
        : [problem(['roles', index], `"${role}" is not a role of the vocabulary`)],
    ),
    ...Object.entries(activity.data ?? {}).flatMap(([name, { model }]) => {
      const missing = model === undefined ? undefined : fieldProblem(contract.model, model)

      return missing === undefined ? [] : [problem(['data', name, 'model'], missing)]
    }),
    ...(has(activity.states, activity.initial)
      ? []
      : [problem(['initial'], `"${activity.initial}" is not a state of the activity`)]),
    ...Object.entries(activity.states).flatMap(([name, state]) =>
      stateProblems(inActivity, name, state),
    ),
    ...unusedGuardProblems(inActivity),
    ...unreachableProblems(inActivity),
    ...stuckProblems(inActivity),
  ]
}

export function activitiesProblems(contract: Contract): Problem[] {
  const screens = new Map(contract.screens.screens.map((screen) => [screen.id, screen]))
  const known = knownAnchors(contract)
  const visibilityButtons = visibilityButtonsOf(contract.screens)
  const declared = new Map(
    declaredAnchors(contract.screens).map(({ anchor, def, screen }) => [anchor, { def, screen }]),
  )

  return contract.activities.flatMap((activity) => {
    const file = activityFile(activity.id)
    const lines = contract.activityLines.get(activity.id)

    return activityProblems({
      activity,
      contract,
      screens,
      known,
      visibilityButtons,
      declared,
      problem: (at, message) => inFile(file, `${jsonPath(at)}: ${message}`, lineAt(lines, at)),
    })
  })
}
