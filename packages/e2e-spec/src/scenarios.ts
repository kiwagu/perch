/**
 * The e2e scenarios of the repository: the files of `tests/e2e/scenarios`, read through the
 * contract's own loader so a scenario means one thing to every tool.
 */

import { formatProblem, loadScenarios, type Scenario } from '@workspace/ui-contract'

export function readScenarios(root: string): { scenarios: Scenario[]; problems: string[] } {
  const { scenarios, problems } = loadScenarios(root)

  return { scenarios, problems: problems.map(formatProblem) }
}
