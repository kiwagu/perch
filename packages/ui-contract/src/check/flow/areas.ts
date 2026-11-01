/**
 * One event, one area: within a parallel state an event (an anchor or a platform event) is
 * handled by one region or by the state's own `on`, never by two of them, as XState would
 * take each one's transition on the same event. The same event may appear in several states
 * of one region. A problem is at the first state of the later area that handles the event.
 */

import type { Problem } from '../../files'
import { flowNodes, type ParallelNode } from '../../files'

import type { InFlow } from './in-flow'

/** The area that first handles an event: a region by name, or the parallel state itself. */
type Handler = { readonly region: string } | { readonly region?: undefined }

function parallelProblems({ flow, at, inScreens }: InFlow, parallel: ParallelNode): Problem[] {
  const first = new Map<string, Handler>(
    Object.keys(parallel.state.on ?? {}).map((event) => [event, {}] as const),
  )
  const reported = new Set<string>()
  const regionStates = flowNodes(flow).filter(
    (node) => node.kind === 'region-state' && node.parallel === parallel.name,
  )

  return regionStates.flatMap((node) => {
    if (node.kind !== 'region-state') {
      return []
    }

    return Object.keys(node.state.on ?? {}).flatMap((event) => {
      const handler = first.get(event)

      if (handler === undefined) {
        first.set(event, { region: node.region })

        return []
      }

      if (handler.region === node.region || reported.has(`${node.region} ${event}`)) {
        return []
      }

      reported.add(`${node.region} ${event}`)

      const by =
        handler.region === undefined
          ? `region "${node.region}" and by the state itself`
          : `region "${handler.region}" and by region "${node.region}"`

      return [inScreens([...at, ...node.at, 'on', event], `"${event}" is handled by ${by}`)]
    })
  })
}

export const areaProblems = (inFlow: InFlow): Problem[] =>
  flowNodes(inFlow.flow).flatMap((node) =>
    node.kind === 'parallel' ? parallelProblems(inFlow, node) : [],
  )
