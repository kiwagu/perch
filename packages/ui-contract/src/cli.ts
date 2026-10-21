#!/usr/bin/env bun
/**
 * The contract tooling, run from the repository root.
 *
 *   ui-contract schemas
 *     writes the JSON Schemas of the contract files under `contract/` from their Zod sources.
 *   ui-contract schemas --check
 *     fails when a committed schema is missing or differs from its source.
 */

import { formatProblem, schemaDrift, writeSchemas } from './files'

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
    case 'schemas':
      return schemas(rest)
    default:
      console.error('ui-contract: use "schemas [--check]"')

      return 1
  }
}

process.exit(run(process.argv.slice(2)))
