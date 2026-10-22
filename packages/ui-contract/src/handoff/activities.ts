/**
 * The activities' side of the coverage: per activity, the scenarios that name it in their
 * `activity`, its transitions (one per branch of each `on`), and how many of them those
 * scenarios walk. A scenario is read in the order of its file, by the lines the loader keeps
 * (`where`, the steps and the expected results, each text's references left to right), with
 * an address per device: a text that opens with `On device X` or `Device X:` speaks for device
 * X, any other for the only device, or else for the device last named (`A` at first). A route
 * moves its device to that address; an anchor named in a step walks the transition on it from
 * every state at its device's address, or from the initial state while that device has named
 * no route. A report, not a rule.
 */

import type { Contract } from '../check'
import { own } from '../check/contract'
import { textsOf } from '../check/scenarios'
import type { Activity } from '../files'
import { type Lines, lineAt } from '../files/problems'
import { referencesIn, type Scenario } from '../scenarios'

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

/** The texts a scenario is walked by, in the order of its file when its lines are known. */
const textsInOrder = (scenario: Scenario, lines: Lines | undefined) =>
  textsOf(scenario)
    .filter(({ at }) => at[0] !== 'scenario')
    .toSorted((a, b) => (lineAt(lines, a.at) ?? 0) - (lineAt(lines, b.at) ?? 0))

/** The device a text speaks for: `On device X` or `Device X:` at its start, X one of `devices`. */
function deviceOf(text: string, devices: readonly string[]): string | undefined {
  const named = /^(?:On device ([A-Z])\b|Device ([A-Z]):)/.exec(text)
  const device = named?.[1] ?? named?.[2]

  return device !== undefined && devices.includes(device) ? device : undefined
}

/** The transitions a scenario walks in an activity, each as `<state> on <anchor>`. */
function walkedBy(activity: Activity, scenario: Scenario, lines: Lines | undefined): Set<string> {
  const walked = new Set<string>()
  const devices = Object.keys(scenario.devices)
  /** The most recent route of each device. */
  const routes = new Map<string, string>()
  let device = devices.includes('A') ? 'A' : (devices[0] ?? '')

  for (const { text, at } of textsInOrder(scenario, lines)) {
    device = devices.length === 1 ? device : (deviceOf(text, devices) ?? device)

    for (const { kind, value } of referencesIn(text).references) {
      const route = routes.get(device)

      if (kind === 'route') {
        routes.set(device, value)
      } else if (kind === 'anchor' && at[0] === 'steps') {
        for (const [name, state] of Object.entries(activity.states)) {
          const here =
            route === undefined ? name === activity.initial : state.meta.address.path === route

          if (here && own(state.on ?? {}, value) !== undefined) {
            walked.add(`${name} on ${value}`)
          }
        }
      }
    }
  }

  return walked
}

export function activityCoverage({
  activities,
  scenarios,
  scenarioLines,
}: Contract): ActivityCoverage[] {
  return activities.map((activity) => {
    const naming = scenarios.filter((scenario) => scenario.activity === activity.id)
    const walked = new Set(
      naming.flatMap((scenario) => [
        ...walkedBy(activity, scenario, scenarioLines.get(scenario.id)),
      ]),
    )
    const branches = branchesOf(activity)

    return {
      id: activity.id,
      scenarios: naming.length,
      transitions: branches.length,
      walked: branches.filter(({ state, anchor }) => walked.has(`${state} on ${anchor}`)).length,
    }
  })
}
