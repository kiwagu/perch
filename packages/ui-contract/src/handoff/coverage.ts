/**
 * How far the contract reaches into the code, for the coverage note: per feature module
 * of the web app and for the UI kit, the controls and how many carry an anchor
 * (`countControls`); per screen, its declared anchors and the scenarios that reach it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { baseOf } from '../anchors'
import { type Contract, loadContract } from '../check'
import { declaredAnchors } from '../check/contract'
import { textsOf } from '../check/scenarios'
import { formatProblem } from '../files'
import { type Reference, referencesIn, type Scenario } from '../scenarios'
import { sourcePaths } from '../sources/scan'

import { countControls } from './controls'

export const FEATURES_DIR = 'apps/web/src/features'
export const UI_KIT_DIR = 'packages/ui/src'
export const UI_KIT_MODULE = 'ui kit'

export interface CoverageMeasure {
  modules: Array<{ module: string; controls: number; marked: number }>
  screens: Array<{ id: string; anchors: number; scenarios: number }>
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

  const modules = new Map(modulesOf(root).map((module) => [module, { controls: 0, marked: 0 }]))

  for (const path of sourcePaths(root).filter((file) => file.endsWith('.tsx'))) {
    const counts = modules.get(moduleOf(path) ?? '')

    if (counts !== undefined) {
      const { controls, marked } = countControls(readFileSync(join(root, path), 'utf8'), path)

      counts.controls += controls
      counts.marked += marked
    }
  }

  const reached = contract.scenarios.map(screensReached(contract))

  return {
    modules: [...modules].map(([module, counts]) => ({ module, ...counts })),
    screens: contract.screens.screens.map(({ id, anchors }) => ({
      id,
      anchors: Object.keys(anchors).length,
      scenarios: reached.filter((screens) => screens.has(id)).length,
    })),
  }
}

const share = (marked: number, controls: number): string =>
  controls === 0 ? '-' : `${Math.round((marked / controls) * 100)}%`

const row = (cells: ReadonlyArray<string | number>): string => `| ${cells.join(' | ')} |`

/** The block of the note: the contract's totals, the modules table and the screens table. */
export function renderCoverage(
  measure: CoverageMeasure,
  totals: { anchors: number; codes: number; screens: number },
): string {
  const controls = measure.modules.reduce((sum, module) => sum + module.controls, 0)
  const marked = measure.modules.reduce((sum, module) => sum + module.marked, 0)

  return [
    `The contract declares ${totals.screens} screens, ${totals.anchors} anchors and ${totals.codes} codes.`,
    '',
    row(['Module', 'Controls', 'Marked', 'Share']),
    row(['---', '---:', '---:', '---:']),
    ...measure.modules.map((module) =>
      row([module.module, module.controls, module.marked, share(module.marked, module.controls)]),
    ),
    row(['all', controls, marked, share(marked, controls)]),
    '',
    row(['Screen', 'Anchors', 'Scenarios']),
    row(['---', '---:', '---:']),
    ...measure.screens.map((screen) => row([screen.id, screen.anchors, screen.scenarios])),
  ].join('\n')
}
