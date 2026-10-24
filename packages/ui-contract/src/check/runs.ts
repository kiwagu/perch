/**
 * Rule 10: every screen's flow and every activity runs in XState as written. The walk
 * (`machines/walk`) builds each with `setup({ guards, actions, actors }).createMachine`, stubs
 * standing in for the guards, the effects and the actors, reaches every state (a parallel
 * state's regions each on its own, the others at their initial) and takes every transition
 * and guarded branch. A state it does not reach, a transition of the flow it never takes, one
 * that lands elsewhere or with other effects than the flow says, and a machine XState will not
 * build are problems. The other rules read a flow as the contract means it; this one asks
 * XState, so a business change to a flow is proven to run with no app involved.
 */

import { activityFile, type Flow, flowNodes, lineAt, type Problem } from '../files'
import { casesOfFlow, sameValue, walk } from '../machines'

import { type Contract, inFile, locate } from './contract'

/** What the walk of one machine finds against what it says, each message on its own. */
function walkMessages(flow: Flow): string[] {
  let walked: ReturnType<typeof walk>

  try {
    walked = walk(flow)
  } catch (error) {
    return [`XState does not build or run the machine: ${String(error)}`]
  }

  const visited = new Set(walked.visited)
  const taken = new Set(walked.cases.map(({ label }) => label))

  return [
    ...flowNodes(flow)
      .map(({ path }) => path)
      .filter((path) => !visited.has(path))
      .map((path) => `${path}: XState does not reach this state`),
    ...casesOfFlow(flow)
      .filter(({ label }) => !taken.has(label))
      .map(({ label }) => `${label}: XState never takes this transition`),
    ...walked.cases
      .filter(({ expected, actual }) => !sameValue(expected, actual))
      .map(
        ({ label, expected, actual }) =>
          `${label}: XState comes to ${JSON.stringify(actual)}, the flow says ${JSON.stringify(expected)}`,
      ),
  ]
}

export function runsProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)

  return [
    ...contract.screens.screens.flatMap(({ flow }, index) =>
      flow === undefined
        ? []
        : walkMessages(flow).map((message) => inScreens(['screens', index, 'flow'], message)),
    ),
    ...contract.activities.flatMap((activity) =>
      walkMessages(activity).map((message) =>
        inFile(
          activityFile(activity.id),
          message,
          lineAt(contract.activityLines.get(activity.id), []),
        ),
      ),
    ),
  ]
}
