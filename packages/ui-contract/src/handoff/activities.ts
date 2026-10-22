/**
 * The activities' side of the coverage: per activity, the scenarios that name it in their
 * `activity`, its transitions (one per branch of each `on`), and how many of them those
 * scenarios walk. A transition from state S on anchor A is walked when one of them names A
 * in a step and the most recent route reference before that step, in `where` or an earlier
 * step, is the address of S; before any route, S is the initial state. A route several states
 * share stands for each of them, and the expected results, written after every step, precede
 * none. A report, not a rule.
 */

import type { Contract } from '../check'
import { own } from '../check/contract'
import type { Activity } from '../files'
import { type Reference, referencesIn, type Scenario } from '../scenarios'

export interface ActivityCoverage {
  id: string
  scenarios: number
  transitions: number
  walked: number
}

/** One branch of a transition: from `state` on `anchor` to `target`. */
export interface ActivityBranch {
  readonly state: string
  readonly anchor: string
  readonly target: string
}

/** Every branch of every transition of an activity, in the order of its file. */
export const branchesOf = ({ states }: Activity): ActivityBranch[] =>
  Object.entries(states).flatMap(([state, { on }]) =>
    Object.entries(on ?? {}).flatMap(([anchor, transitions]) =>
      (Array.isArray(transitions) ? transitions : [transitions]).map(({ target }) => ({
        state,
        anchor,
        target,
      })),
    ),
  )

const valuesOf = (text: string, kind: Reference['kind']): string[] =>
  referencesIn(text)
    .references.filter((reference) => reference.kind === kind)
    .map(({ value }) => value)

/** The transitions a scenario walks in an activity, each as `<state> on <anchor>`. */
function walkedBy(activity: Activity, scenario: Scenario): Set<string> {
  const walked = new Set<string>()
  let route = valuesOf(scenario.where, 'route').at(-1)

  for (const step of scenario.steps) {
    for (const [name, state] of Object.entries(activity.states)) {
      const here =
        route === undefined ? name === activity.initial : state.meta.address.path === route

      for (const anchor of here ? valuesOf(step, 'anchor') : []) {
        if (own(state.on ?? {}, anchor) !== undefined) {
          walked.add(`${name} on ${anchor}`)
        }
      }
    }

    route = valuesOf(step, 'route').at(-1) ?? route
  }

  return walked
}

export function activityCoverage({ activities, scenarios }: Contract): ActivityCoverage[] {
  return activities.map((activity) => {
    const naming = scenarios.filter((scenario) => scenario.activity === activity.id)
    const walked = new Set(naming.flatMap((scenario) => [...walkedBy(activity, scenario)]))
    const branches = branchesOf(activity)

    return {
      id: activity.id,
      scenarios: naming.length,
      transitions: branches.length,
      walked: branches.filter(({ state, anchor }) => walked.has(`${state} on ${anchor}`)).length,
    }
  })
}
