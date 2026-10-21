#!/usr/bin/env bun
/**
 * The contract tooling, run from the repository root.
 *
 *   ui-contract check [--sources]
 *     checks the three contract files under `contract/` against each other; with
 *     `--sources`, then the anchors and codes of the web app and the UI kit against them.
 *   ui-contract schemas
 *     writes the JSON Schemas of the contract files under `contract/` from their Zod sources.
 *   ui-contract schemas --check
 *     fails when a committed schema is missing or differs from its source.
 */

import { type Contract, checkContract, loadContract } from './check'
import { formatProblem, type Problem, schemaDrift, writeSchemas } from './files'
import { compareWithContract, scanSources } from './sources'

const summaryOf = ({ screens, vocabulary }: Contract): string => {
  const anchors = screens.screens.reduce(
    (count, screen) => count + Object.keys(screen.anchors).length,
    0,
  )

  return [
    `contract: ${screens.screens.length} screens`,
    `${anchors} anchors`,
    `${Object.keys(vocabulary.codes).length} codes`,
    `${screens.scenarios.length} scenarios`,
    `version ${screens.version}`,
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

function run(argv: readonly string[]): number {
  const [command, ...rest] = argv

  switch (command) {
    case 'check':
      return check(rest)
    case 'schemas':
      return schemas(rest)
    default:
      console.error('ui-contract: use "check [--sources]" or "schemas [--check]"')

      return 1
  }
}

process.exit(run(process.argv.slice(2)))
