import { entriesOf, isRecord, listOf, recordOf } from '../../records'

export interface ProjectedEffect {
  readonly type: unknown
  readonly params: unknown
}

export interface ProjectedTransition {
  readonly target: unknown
  readonly guard: unknown
  readonly effects: readonly ProjectedEffect[]
}

export interface ProjectedInvoke {
  readonly src: unknown
  readonly onDone: readonly ProjectedTransition[]
  readonly onError: readonly ProjectedTransition[]
}

/** What the comparison holds of a plain state, of the root or of a region. */
export interface ProjectedState {
  readonly final: boolean
  readonly entry: readonly ProjectedEffect[]
  readonly exit: readonly ProjectedEffect[]
  readonly on: Readonly<Record<string, readonly ProjectedTransition[]>>
  readonly invoke: ProjectedInvoke | undefined
  readonly regions?: Readonly<Record<string, ProjectedRegion>>
}

export interface ProjectedRegion {
  readonly initial: unknown
  readonly states: Readonly<Record<string, ProjectedState>>
}

export interface Projection {
  readonly initial: unknown
  readonly states: Readonly<Record<string, ProjectedState>>
}

/** The contract's effects among actions: the app's own (`assign`, a named action) left out. */
const effectsIn = (actions: unknown): ProjectedEffect[] =>
  listOf(actions)
    .filter(isRecord)
    .filter(({ type }) => type === 'show' || type === 'clear' || type === 'navigate')
    .map(({ type, params }) => ({ type, params }))

const transitionsIn = (value: unknown): ProjectedTransition[] =>
  listOf(value).map((each) =>
    isRecord(each)
      ? { target: each['target'], guard: each['guard'], effects: effectsIn(each['actions']) }
      : { target: each, guard: undefined, effects: [] },
  )

function plainOf(state: Readonly<Record<string, unknown>>): ProjectedState {
  const { invoke } = state

  return {
    final: state['type'] === 'final',
    entry: effectsIn(state['entry']),
    exit: effectsIn(state['exit']),
    on: Object.fromEntries(entriesOf(state['on']).map(([event, of]) => [event, transitionsIn(of)])),
    invoke: isRecord(invoke)
      ? {
          src: invoke['src'],
          onDone: transitionsIn(invoke['onDone']),
          onError: transitionsIn(invoke['onError']),
        }
      : undefined,
  }
}

const regionOf = (region: Readonly<Record<string, unknown>>): ProjectedRegion => ({
  initial: region['initial'],
  states: Object.fromEntries(
    entriesOf(region['states']).map(([name, state]) => [name, plainOf(recordOf(state))]),
  ),
})

/**
 * What the comparison holds of a machine config: its initial state and, per state, whether
 * it is final, its entry and exit effects, each event's transitions (target, guard, effects)
 * and its invoke's source and outcomes; for a parallel state, also its regions, each with its
 * initial state and its states, held as plain states are.
 */
export function projected(config: unknown): Projection {
  const root = recordOf(config)

  return {
    initial: root['initial'],
    states: Object.fromEntries(
      entriesOf(root['states']).map(([name, value]) => {
        const state = recordOf(value)

        return [
          name,
          state['type'] === 'parallel'
            ? {
                ...plainOf(state),
                regions: Object.fromEntries(
                  entriesOf(state['states']).map(([region, of]) => [
                    region,
                    regionOf(recordOf(of)),
                  ]),
                ),
              }
            : plainOf(state),
        ]
      }),
    ),
  }
}
