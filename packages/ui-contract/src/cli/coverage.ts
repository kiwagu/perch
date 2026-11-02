/** `ui-contract coverage [--write] [--json] [--unmarked] [--descriptions]`. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { COVERAGE_FILE } from '../files'
import {
  listControls,
  listDescriptions,
  measureCoverage,
  renderCoverage,
  replaceCoverageBlock,
  totalsOf,
} from '../handoff'

import { currentContract, reported } from './problems'

export function coverage(argv: readonly string[]): number {
  const root = process.cwd()
  const contract = currentContract(root)

  if (contract === undefined) {
    return 1
  }

  const measure = measureCoverage(root)
  const totals = totalsOf(contract)

  if (reported(measure.problems)) {
    return 1
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ totals, ...measure }, null, 2))

    return 0
  }

  if (argv.includes('--unmarked')) {
    console.log(listControls(measure))

    return 0
  }

  if (argv.includes('--descriptions')) {
    console.log(listDescriptions(contract))

    return 0
  }

  const block = renderCoverage(measure, totals)

  if (!argv.includes('--write')) {
    console.log(block)

    return 0
  }

  const path = join(root, COVERAGE_FILE)

  writeFileSync(path, replaceCoverageBlock(readFileSync(path, 'utf8'), block))
  console.log(`ui-contract: wrote ${COVERAGE_FILE}`)

  return 0
}
