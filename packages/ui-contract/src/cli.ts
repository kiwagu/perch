#!/usr/bin/env bun
/**
 * The contract tooling, run from the repository root.
 *
 *   ui-contract check [--sources]
 *     checks the contract files under `contract/` and the scenario files under
 *     `tests/e2e/scenarios/` against each other; with `--sources`, then the anchors and codes
 *     of the web app and the UI kit against them.
 *   ui-contract schemas
 *     writes the JSON Schemas of the contract files under `contract/` from their Zod sources.
 *   ui-contract schemas --check
 *     fails when a committed schema is missing or differs from its source.
 *   ui-contract manifest [--out <dir>]
 *     builds the UI manifest from the contract files and the scenarios and writes it,
 *     with its schema and the model's beside it, into `<dir>` (default `ui-manifest`,
 *     relative to the working directory; its last segment is `ui-manifest`). Runs from the
 *     root or any folder under it.
 *   ui-contract diff <ref> [--json]
 *     prints what the contract of the working tree adds, removes and renames against the
 *     contract at the git ref `<ref>` (all of it as added when the ref has no `contract/`):
 *     the hand-over block of a change, or the changes as JSON.
 *   ui-contract coverage [--write] [--json] [--unmarked]
 *     prints the coverage block (the fields and actions of the model bound by anchors, the
 *     controls marked per module, anchors and scenarios per screen), writes it between the
 *     markers of `contract/COVERAGE.md`, prints the measure as JSON, or lists the unmarked
 *     and the ignored controls as `file:line: <element>`. A coverage-ignore marker it cannot
 *     apply is printed as a problem, and nothing is written.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { type Contract, checkContract, loadContract } from './check'
import {
  COVERAGE_FILE,
  formatProblem,
  PLATFORM_FILE,
  type Problem,
  schemaDrift,
  writeSchemas,
} from './files'
import {
  contractAt,
  diffContracts,
  formatChanges,
  listControls,
  measureCoverage,
  renderCoverage,
  replaceCoverageBlock,
  totalsOf,
} from './handoff'
import { emitManifest, MANIFEST_DIR } from './manifest'
import { compareWithContract, scanSources } from './sources'

const summaryOf = (contract: Contract): string => {
  const { anchors, codes, screens } = totalsOf(contract)

  return [
    `contract: ${screens} screens`,
    `${anchors} anchors`,
    `${codes} codes`,
    `${contract.scenarios.length} scenarios`,
    `version ${contract.screens.version}`,
  ].join(', ')
}

const reported = (problems: readonly Problem[]): boolean => {
  for (const problem of problems) {
    console.error(formatProblem(problem))
  }

  return problems.length > 0
}

function checkSources(root: string, { screens, vocabulary }: Contract): number {
  const collected = scanSources(root)

  if (reported(compareWithContract(collected, screens, vocabulary))) {
    return 1
  }

  const anchors = new Set(collected.flatMap(({ literals }) => literals.map(({ anchor }) => anchor)))

  console.log(`contract: sources agree with the contract (${anchors.size} anchors)`)

  return 0
}

function check(argv: readonly string[]): number {
  const root = process.cwd()

  if (reported(checkContract(root))) {
    return 1
  }

  const { contract } = loadContract(root)

  if (contract === undefined) {
    return 1
  }

  console.log(summaryOf(contract))

  return argv.includes('--sources') ? checkSources(root, contract) : 0
}

function schemas(argv: readonly string[]): number {
  const root = process.cwd()

  if (!argv.includes('--check')) {
    for (const file of writeSchemas(root)) {
      console.log(`ui-contract: wrote ${file}`)
    }

    return 0
  }

  if (reported(schemaDrift(root))) {
    return 1
  }

  console.log('ui-contract: the schemas match their sources')

  return 0
}

/** The nearest folder at or above `from` that holds the contract. */
function contractRoot(from: string): string | undefined {
  for (let folder = from; ; folder = dirname(folder)) {
    if (existsSync(join(folder, PLATFORM_FILE))) {
      return folder
    }

    if (dirname(folder) === folder) {
      return undefined
    }
  }
}

function manifest(argv: readonly string[]): number {
  const at = argv.indexOf('--out')
  const out = resolve(at === -1 ? MANIFEST_DIR : (argv[at + 1] ?? ''))
  const root = contractRoot(process.cwd())

  if (root === undefined) {
    console.error(`ui-contract: no ${PLATFORM_FILE} here or in a folder above`)

    return 1
  }

  if (reported(emitManifest(root, out))) {
    return 1
  }

  console.log(`ui-contract: wrote ${join(out, 'manifest.json')}`)

  return 0
}

/** The contract of the working tree, or undefined once its problems are printed. */
function currentContract(root: string): Contract | undefined {
  const { contract, problems } = loadContract(root)

  reported(problems)

  return contract
}

function diff(argv: readonly string[]): number {
  const [ref, ...extra] = argv.filter((argument) => argument !== '--json')
  const root = process.cwd()

  if (ref === undefined || extra.length > 0) {
    console.error('ui-contract: use "diff <ref> [--json]"')

    return 1
  }

  const after = currentContract(root)

  if (after === undefined) {
    return 1
  }

  const before = contractAt(ref, root)
  const changes = diffContracts('missing' in before ? undefined : before, after)

  console.log(argv.includes('--json') ? JSON.stringify(changes, null, 2) : formatChanges(changes))

  return 0
}

function coverage(argv: readonly string[]): number {
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

function run(argv: readonly string[]): number {
  const [command, ...rest] = argv

  switch (command) {
    case 'check':
      return check(rest)
    case 'schemas':
      return schemas(rest)
    case 'manifest':
      return manifest(rest)
    case 'diff':
      return diff(rest)
    case 'coverage':
      return coverage(rest)
    default:
      console.error(
        'ui-contract: use "check [--sources]", "schemas [--check]", "manifest [--out <dir>]", "diff <ref> [--json]" or "coverage [--write] [--json] [--unmarked]"',
      )

      return 1
  }
}

/** A command that cannot go on throws; its message is printed and the exit code is 1. */
function main(argv: readonly string[]): number {
  try {
    return run(argv)
  } catch (error) {
    console.error(`ui-contract: ${error instanceof Error ? error.message : String(error)}`)

    return 1
  }
}

process.exit(main(process.argv.slice(2)))
