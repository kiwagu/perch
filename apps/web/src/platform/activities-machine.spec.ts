/**
 * Each activity of the contract is a machine XState runs as written, as each screen's flow is
 * (`flows-machine.spec.ts`): the same walk (`flows-machine.walk.ts`) builds it with a stub per
 * guard of `meta.guards`, reaches every state, and takes every transition, every guarded
 * branch with its guard holding, to its target. Its states are visits to screens at
 * addresses the contract check holds to bindings, which the router proves
 * (`routes-router.spec.ts`); the app has no machine of its own for an activity, so nothing
 * is compared with the app.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadActivities } from '@workspace/ui-contract'

import { casesOfFlow, walk } from './flows-machine.walk'

const ROOT = join(import.meta.dirname, '../../../..')

const { activities, problems } = loadActivities(ROOT)
const machines = activities.map((activity) => [activity.id, activity] as const)

describe('the activities of the contract in XState', () => {
  it('read a contract with activities', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(machines.length).toBeGreaterThan(0)
  })

  it.each(machines)('%s reaches every state', (_, activity) => {
    expect([...walk(activity).visited].sort()).toEqual(Object.keys(activity.states).sort())
  })

  it.each(machines)('%s takes every transition to its target', (_, activity) => {
    const { cases } = walk(activity)

    expect(cases.map(({ label }) => label).sort()).toEqual(
      casesOfFlow(activity)
        .map(({ label }) => label)
        .sort(),
    )

    for (const { label, expected, actual } of cases) {
      expect(actual, label).toEqual(expected)
    }
  })
})
