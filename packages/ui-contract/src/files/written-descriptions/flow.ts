/**
 * The descriptions a screen's flow writes, as its file authors it: the flow's own, each sentence
 * guard of its `meta.guards` (a guard by failure code is structure), each state's, plain or
 * parallel, each region's, written in full, by its pattern or by its button, each region state's,
 * and each transition's: on an event, an outcome of an invoke or of a region's button, by the
 * state it leaves (`<screen> flow viewing.notes.idle on <event> #2`). What the loader fills in
 * as it expands the shorter forms, or derives (a button's region), is never written, so never read.
 */

import { entriesOf, recordOf } from '../../records'

import { describedAt, type Found, meaningsAt, transitionsAt } from './found'

const OUTCOMES = ['onDone', 'onError'] as const

/** The descriptions of the outcomes `owner` writes: an invoke's, or a region's by its button. */
const outcomesAt = (owner: unknown, at: readonly PropertyKey[], place: string): Found[] =>
  OUTCOMES.flatMap((outcome) =>
    transitionsAt(recordOf(owner)[outcome], [...at, outcome], 'transition', `${place} ${outcome}`),
  )

/** A state of the root or of a region, named by its path from the root; a parallel state with its regions. */
function stateAt(
  state: unknown,
  at: readonly PropertyKey[],
  path: readonly string[],
  head: string,
): Found[] {
  const { on, invoke, type, states } = recordOf(state)
  const place = `${head} ${path.join('.')}`

  return [
    ...describedAt(state, at, 'state', place),
    ...entriesOf(on).flatMap(([event, transitions]) =>
      transitionsAt(transitions, [...at, 'on', event], 'transition', `${place} on ${event}`),
    ),
    ...outcomesAt(invoke, [...at, 'invoke'], place),
    ...(type === 'parallel'
      ? entriesOf(states).flatMap(([name, region]) =>
          regionAt(region, [...at, 'states', name], [...path, name], head),
        )
      : []),
  ]
}

/** A region of a parallel state: its own description, a button's outcomes, its states. */
function regionAt(
  region: unknown,
  at: readonly PropertyKey[],
  path: readonly string[],
  head: string,
): Found[] {
  const place = `${head} ${path.join('.')}`

  return [
    ...describedAt(region, at, 'region', place),
    ...outcomesAt(region, at, place),
    ...entriesOf(recordOf(region)['states']).flatMap(([name, state]) =>
      stateAt(state, [...at, 'states', name], [...path, name], head),
    ),
  ]
}

/** The descriptions the flow of the screen `screen` writes, at `flow` in its file. */
export function flowDescriptions(flow: unknown, screen: string): Found[] {
  const at = ['flow']
  const head = `${screen} flow`
  const { meta, states } = recordOf(flow)

  return [
    ...describedAt(flow, at, 'flow', head),
    ...meaningsAt(
      recordOf(meta)['guards'],
      [...at, 'meta', 'guards'],
      'guard',
      (name) => `${screen} guard ${name}`,
    ),
    ...entriesOf(states).flatMap(([name, state]) =>
      stateAt(state, [...at, 'states', name], [name], head),
    ),
  ]
}
