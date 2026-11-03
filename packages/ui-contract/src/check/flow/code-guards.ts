/**
 * The guards `meta.guards` writes by failure code, `{ codes: [ … ] }`: such a guard holds when
 * the action of the invoke whose `onError` it guards failed with one of its codes. So it guards
 * only a branch of an invoke's `onError` (a region written `by` its button included, as the
 * loader expands it into one), each code one that action fails with, each listed once. A
 * transition on an event or an `onDone` it guards is a problem: no failure is there to tell
 * apart.
 */

import type { FlowTransition, Problem } from '../../files'
import { failuresOf, flowNodes } from '../../files'

import type { At, InFlow } from './in-flow'

type Guards = ReadonlyMap<string, readonly string[]>

type Transitions = FlowTransition | FlowTransition[]

/** Each transition of one or a list, with where it is. */
const placed = (transitions: Transitions, at: At): Array<readonly [FlowTransition, At]> =>
  Array.isArray(transitions)
    ? transitions.map((transition, index) => [transition, [...at, index]] as const)
    : [[transitions, at] as const]

/** Each code of a guard listed once. */
const repeatedProblems = ({ at, inScreens }: InFlow, guards: Guards): Problem[] =>
  [...guards].flatMap(([name, codes]) =>
    codes.flatMap((code, index) =>
      codes.indexOf(code) < index
        ? [
            inScreens(
              [...at, 'meta', 'guards', name, 'codes', index],
              `"${code}" is already listed`,
            ),
          ]
        : [],
    ),
  )

/** A transition outside an `onError` that a guard by failure code guards. */
const misplacedProblems = (
  { inScreens }: InFlow,
  guards: Guards,
  transitions: Transitions,
  at: At,
): Problem[] =>
  placed(transitions, at).flatMap(([{ guard }, where]) =>
    guard !== undefined && guards.has(guard)
      ? [
          inScreens(
            [...where, 'guard'],
            `"${guard}" is a guard by failure code: it guards only a branch of an invoke's onError`,
          ),
        ]
      : [],
  )

/** Each branch of an `onError` a guard by failure code guards: its codes are failures of `src`. */
function branchProblems(
  { inScreens }: InFlow,
  guards: Guards,
  failed: readonly string[] | undefined,
  src: string,
  onError: Transitions,
  at: At,
): Problem[] {
  return placed(onError, at).flatMap(([{ guard }, where]) => {
    const codes = guard === undefined ? undefined : guards.get(guard)
    const strays =
      failed === undefined ? [] : (codes ?? []).filter((code) => !failed.includes(code))

    return strays.length === 0
      ? []
      : [
          inScreens(
            [...where, 'guard'],
            `"${guard}" names ${strays.map((code) => `"${code}"`).join(', ')}, which ${src} does not fail with`,
          ),
        ]
  })
}

export function codeGuardProblems(inFlow: InFlow): Problem[] {
  const { flow, contract } = inFlow
  const guards: Guards = new Map(
    Object.entries(flow.meta?.guards ?? {}).flatMap(([name, guard]) =>
      typeof guard === 'string' ? [] : [[name, guard.codes] as const],
    ),
  )

  if (guards.size === 0) {
    return []
  }

  const failureOf = failuresOf(contract.model, contract.screens.platform.actions)

  return [
    ...repeatedProblems(inFlow, guards),
    ...flowNodes(flow).flatMap((node) => {
      if (node.kind === 'region') {
        return []
      }

      const at = [...inFlow.at, ...node.at]
      const invoke = node.kind === 'parallel' ? undefined : node.state.invoke
      const failure = invoke === undefined ? undefined : failureOf(invoke.src)

      return [
        ...Object.entries(node.state.on ?? {}).flatMap(([event, transitions]) =>
          misplacedProblems(inFlow, guards, transitions, [...at, 'on', event]),
        ),
        ...(invoke === undefined
          ? []
          : [
              ...misplacedProblems(inFlow, guards, invoke.onDone, [...at, 'invoke', 'onDone']),
              ...(invoke.onError === undefined
                ? []
                : branchProblems(
                    inFlow,
                    guards,
                    typeof failure === 'object' ? failure.codes : undefined,
                    invoke.src,
                    invoke.onError,
                    [...at, 'invoke', 'onError'],
                  )),
            ]),
      ]
    }),
  ]
}
