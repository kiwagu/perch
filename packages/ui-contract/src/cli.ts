#!/usr/bin/env bun
/**
 * The contract tooling, run from the repository root.
 *
 *   ui-contract check [--sources]
 *     checks the three contract files under `contract/` against each other; `--sources`
 *     (the anchors of the sources against the contract) is not implemented yet.
 *   ui-contract schemas
 *     writes the JSON Schemas of the contract files under `contract/` from their Zod sources.
 *   ui-contract schemas --check
 *     fails when a committed schema is missing or differs from its source.
 */

import { type Contract, checkContract, loadContract } from './check'
import { formatProblem, schemaDrift, writeSchemas } from './files'

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

function check(argv: readonly string[]): number {
  const root = process.cwd()

  if (argv.includes('--sources')) {
    console.error('ui-contract: check --sources is not implemented yet; checking the files only')
  }

  const problems = checkContract(root)

  for (const problem of problems) {
    console.error(formatProblem(problem))
  }

  if (problems.length > 0) {
    return 1
  }

  const { contract } = loadContract(root)

  if (contract !== undefined) {
    console.log(summaryOf(contract))
  }

  return 0
}

function schemas(argv: readonly string[]): number {
  const root = process.cwd()

  if (!argv.includes('--check')) {
    for (const file of writeSchemas(root)) {
      console.log(`ui-contract: wrote ${file}`)
    }

    return 0
  }

  const problems = schemaDrift(root)

  for (const problem of problems) {
    console.error(formatProblem(problem))
  }

  if (problems.length === 0) {
    console.log('ui-contract: the schemas match their sources')
  }

  return problems.length === 0 ? 0 : 1
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
