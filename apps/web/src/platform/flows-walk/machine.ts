/**
 * A screen's flow as XState runs it: `setup({ guards, actions, actors }).createMachine(flow)`
 * takes the flow of the contract unchanged, with a stub per guard of `meta.guards` (it holds
 * while `holds` names it), the effects `show` and `navigate` as no-ops and an actor per
 * `invoke.src`, of a state of the root or of a region, that resolves.
 */

import { type AnyEventObject, fromPromise, setup } from 'xstate'

import { type Effect, type Flow, flowNodes } from '@workspace/ui-contract'

type ShowParams = Extract<Effect, { type: 'show' }>['params']
type NavigateParams = Extract<Effect, { type: 'navigate' }>['params']

export function machineOf(flow: Flow, holds: ReadonlySet<string>) {
  const guards = Object.keys(flow.meta?.guards ?? {}).map(
    (name) => [name, () => holds.has(name)] as const,
  )
  const actors = flowNodes(flow).flatMap((node) => {
    const invoke =
      node.kind === 'root' || node.kind === 'region-state' ? node.state.invoke : undefined

    return invoke === undefined ? [] : [[invoke.src, fromPromise(async () => undefined)] as const]
  })

  return setup({
    types: { events: {} as AnyEventObject },
    guards: Object.fromEntries(guards),
    actions: {
      show: (_args: unknown, _params: ShowParams) => undefined,
      navigate: (_args: unknown, _params: NavigateParams) => undefined,
    },
    actors: Object.fromEntries(actors),
  }).createMachine(flow)
}

export type Machine = ReturnType<typeof machineOf>
