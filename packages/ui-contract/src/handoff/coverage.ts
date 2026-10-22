/**
 * How far the contract reaches, for the coverage note. Its first measure is the model's: per
 * entity, every field and action with the anchors bound to it (`modelCoverage`), and per
 * activity the scenarios that name it and the transitions they walk (`activityCoverage`).
 * Then the code's: per feature module of the web app and for the UI kit, the controls and
 * how many carry an anchor (`countControls`), with the unmarked controls and the ones a
 * coverage-ignore marker declares off listed by file and line; and per screen, its declared
 * anchors and the scenarios that reach it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { baseOf } from '../anchors'
import { type Contract, loadContract } from '../check'
import { declaredAnchors } from '../check/contract'
import { textsOf } from '../check/scenarios'
import { formatProblem, type Problem, sortProblems } from '../files'
import { type Reference, referencesIn, type Scenario } from '../scenarios'
import { sourcePaths } from '../sources/scan'

import { type ActivityCoverage, activityCoverage } from './activities'
import { type ControlPlace, countControls } from './controls'
import { type ModelCoverage, modelCoverage } from './model'

export const FEATURES_DIR = 'apps/web/src/features'
export const UI_KIT_DIR = 'packages/ui/src'
export const UI_KIT_MODULE = 'ui kit'

/** A control of a source file, by the file's repository path. */
export type FileControl = ControlPlace & { file: string }

export interface CoverageMeasure {
  model: ModelCoverage[]
  activities: ActivityCoverage[]
  modules: Array<{ module: string; controls: number; marked: number; ignored: number }>
  unmarked: FileControl[]
  ignored: Array<FileControl & { reason: string }>
  screens: Array<{ id: string; anchors: number; scenarios: number }>
  /** The coverage-ignore markers that cannot be applied. */
  problems: Problem[]
}

/** The feature folders, sorted, then the kit. */
const modulesOf = (root: string): string[] => [
  ...readdirSync(join(root, FEATURES_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort((a, b) => a.localeCompare(b, 'en')),
  UI_KIT_MODULE,
]

function moduleOf(path: string): string | undefined {
  if (path.startsWith(`${UI_KIT_DIR}/`)) {
    return UI_KIT_MODULE
  }

  const [module] = path.startsWith(`${FEATURES_DIR}/`)
    ? path.slice(FEATURES_DIR.length + 1).split('/')
    : []

  return module
}

/** The screens a scenario reaches: through an anchor it names, or a route of the screen. */
function screensReached(contract: Contract): (scenario: Scenario) => Set<string> {
  const screenOfAnchor = new Map(
    declaredAnchors(contract.screens).map(({ anchor, screen }) => [anchor, screen.id]),
  )
  const screenOfRoute = new Map(
    contract.screens.screens.flatMap((screen) =>
      screen.bindings.map(({ path }) => [path, screen.id] as const),
    ),
  )
  const suffixes = Object.keys(contract.vocabulary.suffixes)
  const screenOf = ({ kind, value }: Reference): string | undefined => {
    if (kind === 'route') {
      return screenOfRoute.get(value)
    }

    return kind === 'anchor'
      ? (screenOfAnchor.get(value) ?? screenOfAnchor.get(baseOf(value, suffixes) ?? ''))
      : undefined
  }

  return (scenario) =>
    new Set(
      textsOf(scenario).flatMap(({ text }) =>
        referencesIn(text).references.flatMap((reference) => screenOf(reference) ?? []),
      ),
    )
}

/** The totals the note opens with. */
export const totalsOf = ({ screens, vocabulary }: Contract) => ({
  anchors: declaredAnchors(screens).length,
  codes: Object.keys(vocabulary.codes).length,
  screens: screens.screens.length,
})

/** The measure of the repository at `root`; a contract that does not load is an error. */
export function measureCoverage(root: string): CoverageMeasure {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the contract does not load: ${problems.map(formatProblem).join('; ')}`)
  }

  const modules = new Map(
    modulesOf(root).map((module) => [module, { controls: 0, marked: 0, ignored: 0 }]),
  )
  const measure: CoverageMeasure = {
    model: modelCoverage(contract),
    activities: activityCoverage(contract),
    modules: [],
    unmarked: [],
    ignored: [],
    screens: [],
    problems: [],
  }

  for (const file of sourcePaths(root).filter((path) => path.endsWith('.tsx'))) {
    const counts = modules.get(moduleOf(file) ?? '')

    if (counts !== undefined) {
      const counted = countControls(readFileSync(join(root, file), 'utf8'), file)

      counts.controls += counted.controls
      counts.marked += counted.marked
      counts.ignored += counted.ignored.length
      measure.unmarked.push(...counted.unmarked.map((place) => ({ file, ...place })))
      measure.ignored.push(...counted.ignored.map((place) => ({ file, ...place })))
      measure.problems.push(...counted.problems)
    }
  }

  const reached = contract.scenarios.map(screensReached(contract))

  return {
    ...measure,
    modules: [...modules].map(([module, counts]) => ({ module, ...counts })),
    screens: contract.screens.screens.map(({ id, anchors }) => ({
      id,
      anchors: Object.keys(anchors).length,
      scenarios: reached.filter((screens) => screens.has(id)).length,
    })),
    problems: sortProblems(measure.problems),
  }
}
