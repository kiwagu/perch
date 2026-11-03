/**
 * A flow as lines for the hand-over diff, one per fact a machine runs: its initial state and
 * each region's, each state's address (the path and the search a link or a reload restores it
 * by), each entry and exit effect, each transition on an event with its target, guard and
 * effects, each invoke with its input and its outcomes, each final state. A state is
 * named by its path (`viewing.form.open`); descriptions are left out, as they change nothing
 * that runs. The diff compares lines as sets, so where order runs the machine a line carries
 * its position, `#<n>`, in a sequence of more than one: the guarded alternatives of an event
 * or an outcome (the first that holds is taken) and a state's entry and exit effects.
 */

import { type Effect, type Flow, type FlowState, type FlowTransition, flowNodes } from '../files'
import { isRecord } from '../records'

type FlowAddress = NonNullable<NonNullable<FlowState['meta']>['address']>

const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/** Each item with its position, ` #<n>`, in a sequence of more than one; a single one has none. */
const positioned = <T>(items: readonly T[]): Array<{ at: string; item: T }> =>
  items.map((item, index) => ({ at: items.length > 1 ? ` #${index + 1}` : '', item }))

/** `value` as JSON, each object's keys sorted, so the order a file writes them in is no change. */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, each: unknown) =>
    isRecord(each)
      ? Object.fromEntries(Object.entries(each).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : each,
  )

const effectText = (effect: Effect): string => {
  switch (effect.type) {
    case 'show':
      return `show ${effect.params.anchor}: ${effect.params.codes.join(' ')}`
    case 'clear':
      return `clear ${effect.params.anchor}`
    case 'navigate':
      return `navigate ${effect.params.to}${effect.params.search === undefined ? '' : ` ${JSON.stringify(effect.params.search)}`}`
  }
}

/** The line of a state's address: its path and its search as JSON, those it has. */
const addressLine = (path: string, address: FlowAddress): string =>
  [
    `${path} address`,
    ...(address.path === undefined ? [] : [address.path]),
    ...(address.search === undefined ? [] : [canonicalJson(address.search)]),
  ].join(' ')

/** `<head>`, then the transition's target, guard and effects, those it has. */
const transitionLine = (head: string, transition: FlowTransition): string =>
  [
    head,
    ...(transition.target === undefined ? [] : [`-> ${transition.target}`]),
    ...(transition.guard === undefined ? [] : [`[${transition.guard}]`]),
    ...(transition.actions ?? []).map(effectText),
  ].join(' ')

/** The lines of the transitions of `head` in order, each numbered when there are more than one. */
const transitionLines = (
  head: string,
  transitions: FlowTransition | FlowTransition[] | undefined,
): string[] =>
  positioned(asList(transitions)).map(({ at, item }) => transitionLine(`${head}${at}`, item))

/** The lines of `flow`, in the order of its file: a parallel state before its regions. */
export function flowLines(flow: Flow): string[] {
  return [
    `initial ${flow.initial}`,
    ...flowNodes(flow).flatMap(({ kind, path, state }) => {
      if (kind === 'region') {
        return [`${path} initial ${state.initial}`]
      }

      const invoke = 'invoke' in state ? state.invoke : undefined
      const address = kind === 'region-state' ? undefined : state.meta?.address

      return [
        ...(address === undefined ? [] : [addressLine(path, address)]),
        ...positioned(state.entry ?? []).map(
          ({ at, item }) => `${path} entry${at} ${effectText(item)}`,
        ),
        ...positioned(state.exit ?? []).map(
          ({ at, item }) => `${path} exit${at} ${effectText(item)}`,
        ),
        ...Object.entries(state.on ?? {}).flatMap(([event, transitions]) =>
          transitionLines(`${path} on ${event}`, transitions),
        ),
        ...(invoke === undefined
          ? []
          : [
              `${path} invoke ${invoke.src}${invoke.input === undefined ? '' : ` ${canonicalJson(invoke.input)}`}`,
              ...transitionLines(`${path} onDone`, invoke.onDone),
              ...transitionLines(`${path} onError`, invoke.onError),
            ]),
        ...('type' in state && state.type === 'final' ? [`${path} final`] : []),
      ]
    }),
  ]
}
