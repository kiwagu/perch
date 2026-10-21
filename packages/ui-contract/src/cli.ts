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
 *   ui-contract manifest [--out <dir>]
 *     builds the UI manifest from the three contract files and writes it, with its schema and
 *     the model's beside it, into `<dir>` (default `ui-manifest`, relative to the working
 *     directory; its last segment is `ui-manifest`). Runs from the root or any folder under it.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { type Contract, checkContract, loadContract } from './check'
import { formatProblem, type Problem, SCREENS_FILE, schemaDrift, writeSchemas } from './files'
import { emitManifest, MANIFEST_DIR } from './manifest'
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

/** The nearest folder at or above `from` that holds the contract. */
function contractRoot(from: string): string | undefined {
  for (let folder = from; ; folder = dirname(folder)) {
    if (existsSync(join(folder, SCREENS_FILE))) {
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
    console.error(`ui-contract: no ${SCREENS_FILE} here or in a folder above`)

    return 1
  }

  if (reported(emitManifest(root, out))) {
    return 1
  }

  console.log(`ui-contract: wrote ${join(out, 'manifest.json')}`)

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
    default:
      console.error(
        'ui-contract: use "check [--sources]", "schemas [--check]" or "manifest [--out <dir>]"',
      )

      return 1
  }
}

process.exit(run(process.argv.slice(2)))
