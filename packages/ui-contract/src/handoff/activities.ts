/**
 * The activities' side of the coverage: per activity, the scenarios that name it in their
 * `activity`, its transitions, and how many of them those scenarios walk, a transition
 * counting as walked once one of them names its anchor in brackets. A report, not a rule.
 */

import type { Contract } from '../check'
import { textsOf } from '../check/scenarios'
import { referencesIn, type Scenario } from '../scenarios'

export interface ActivityCoverage {
  id: string
  scenarios: number
  transitions: number
  walked: number
}

/** The anchors a scenario names in brackets. */
const anchorsNamedIn = (scenario: Scenario): string[] =>
  textsOf(scenario).flatMap(({ text }) =>
    referencesIn(text)
      .references.filter(({ kind }) => kind === 'anchor')
      .map(({ value }) => value),
  )

export function activityCoverage({ activities, scenarios }: Contract): ActivityCoverage[] {
  return activities.map(({ id, states }) => {
    const naming = scenarios.filter((scenario) => scenario.activity === id)
    const named = new Set(naming.flatMap(anchorsNamedIn))
    const anchors = Object.values(states).flatMap(({ on }) =>
      Object.entries(on ?? {}).flatMap(([anchor, transitions]) =>
        (Array.isArray(transitions) ? transitions : [transitions]).map(() => anchor),
      ),
    )

    return {
      id,
      scenarios: naming.length,
      transitions: anchors.length,
      walked: anchors.filter((anchor) => named.has(anchor)).length,
    }
  })
}
