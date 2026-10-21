/**
 * The e2e scenarios of the contract: the `scenarios` of `contract/screens.json`, read through
 * the contract's own loader so the file means one thing to every tool.
 */

import { resolve, sep } from 'node:path'

import { formatProblem, loadScreens, SCREENS_FILE, type Scenario } from '@workspace/ui-contract'

/** `<root>/contract/screens.json` → `<root>`, or nothing when the path names another file. */
function rootOf(screensPath: string): string | undefined {
  const absolute = resolve(screensPath)
  const tail = `${sep}${SCREENS_FILE.split('/').join(sep)}`

  return absolute.endsWith(tail) ? absolute.slice(0, -tail.length) || sep : undefined
}

export function readScenarios(screensPath: string): { scenarios: Scenario[]; problems: string[] } {
  const root = rootOf(screensPath)

  if (root === undefined) {
    return { scenarios: [], problems: [`${screensPath} is not ${SCREENS_FILE} under a root`] }
  }

  const { screens, problems } = loadScreens(root)

  return { scenarios: screens?.scenarios ?? [], problems: problems.map(formatProblem) }
}
