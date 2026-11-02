/**
 * A flow as lines for the hand-over diff, one per fact a machine runs: its initial state and
 * each region's, each entry and exit effect, each transition on an event with its target,
 * guard and effects, each invoke and its outcomes, each final state. A state is named by its
 * path (`viewing.form.open`); descriptions are left out, as they change nothing that runs.
 */

import { type Effect, type Flow, type FlowTransition, flowNodes } from '../files'

const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

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

/** `<head>`, then the transition's target, guard and effects, those it has. */
const transitionLine = (head: string, transition: FlowTransition): string =>
  [
    head,
    ...(transition.target === undefined ? [] : [`-> ${transition.target}`]),
    ...(transition.guard === undefined ? [] : [`[${transition.guard}]`]),
    ...(transition.actions ?? []).map(effectText),
  ].join(' ')

/** The lines of `flow`, in the order of its file: a parallel state before its regions. */
export function flowLines(flow: Flow): string[] {
  return [
    `initial ${flow.initial}`,
    ...flowNodes(flow).flatMap(({ kind, path, state }) => {
      if (kind === 'region') {
        return [`${path} initial ${state.initial}`]
      }

      const invoke = 'invoke' in state ? state.invoke : undefined

      return [
        ...(state.entry ?? []).map((effect) => `${path} entry ${effectText(effect)}`),
        ...(state.exit ?? []).map((effect) => `${path} exit ${effectText(effect)}`),
        ...Object.entries(state.on ?? {}).flatMap(([event, transitions]) =>
          asList(transitions).map((each) => transitionLine(`${path} on ${event}`, each)),
        ),
        ...(invoke === undefined
          ? []
          : [
              `${path} invoke ${invoke.src}`,
              ...asList(invoke.onDone).map((each) => transitionLine(`${path} onDone`, each)),
              ...asList(invoke.onError).map((each) => transitionLine(`${path} onError`, each)),
            ]),
        ...('type' in state && state.type === 'final' ? [`${path} final`] : []),
      ]
    }),
  ]
}
