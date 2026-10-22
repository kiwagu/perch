/**
 * Reads `tests/e2e/scenarios`: each `.md` file under it, at any depth and sorted by path, is
 * one scenario, its id the path without `.md` (`user/base/sign-up`). A missing folder, a
 * file that is not `.md`, a path outside the id grammar or with a layer the grammar does
 * not know, and the problems of a file's text are problems of that file.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { parseScenario, SCENARIO_LAYERS, type Scenario, scenarioSchema } from '../scenarios'

import { SCENARIOS_DIR } from './paths'
import type { Problem } from './problems'

const SUFFIX = '.md'

const NOT_AN_ID = `not a scenario path: <entity>/<layer>/[<area>/]<slug>${SUFFIX} in kebab-case, the layer one of ${SCENARIO_LAYERS.join(', ')}`

/** The files under `dir` as paths relative to it with `/` separators, sorted. */
function filesUnder(dir: string): string[] | undefined {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .sort()
  } catch {
    return undefined
  }
}

const isScenarioId = (id: string): boolean =>
  scenarioSchema.shape.id.safeParse(id).success && SCENARIO_LAYERS.includes(id.split('/')[1] ?? '')

export function loadScenarios(root: string): { scenarios: Scenario[]; problems: Problem[] } {
  const paths = filesUnder(join(root, SCENARIOS_DIR))

  if (paths === undefined) {
    return { scenarios: [], problems: [{ file: SCENARIOS_DIR, message: 'cannot read the folder' }] }
  }

  const scenarios: Scenario[] = []
  const problems: Problem[] = []

  for (const path of paths) {
    const id = path.slice(0, -SUFFIX.length)
    const file = `${SCENARIOS_DIR}/${path}`

    if (!path.endsWith(SUFFIX)) {
      problems.push({
        file,
        message: `not a scenario file: the folder holds \`<id>${SUFFIX}\` files only`,
      })
    } else if (!isScenarioId(id)) {
      problems.push({ file, message: NOT_AN_ID })
    } else {
      const parsed = parseScenario(id, readFileSync(join(root, file), 'utf8'))

      problems.push(...parsed.problems.map((problem) => ({ file, ...problem })))

      if (parsed.scenario !== undefined) {
        scenarios.push(parsed.scenario)
      }
    }
  }

  return { scenarios, problems }
}
