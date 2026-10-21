#!/usr/bin/env bun
/**
 * The e2e scenarios of `contract/screens.json` and their Playwright tests.
 *
 *   e2e-spec scaffold <scenario id> [--screens=<file>] [--tests=<dir>]
 *     writes the test skeleton of the scenario to its pair, `<tests>/<id>.e2e.spec.ts`;
 *     an existing test is never overwritten.
 *   e2e-spec coverage [--screens=<file>] [--tests=<dir>]
 *     fails when a scenario has no test, a test has no scenario, a test's first line does
 *     not name its scenario, a test has fewer steps than its scenario, or the screens file
 *     cannot be read.
 *
 * Paths are relative to the current directory; the defaults, `contract/screens.json` and
 * `tests/e2e/src`, suit the root scripts, which run from the repository root.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { checkCoverage } from './coverage'
import { scaffoldTest, testPathFor } from './scaffold'
import { readScenarios } from './scenarios'

const readOption = (argv: readonly string[], name: string, fallback: string): string =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const screensOf = (argv: readonly string[]): string =>
  readOption(argv, 'screens', 'contract/screens.json')

const testsOf = (argv: readonly string[]): string => readOption(argv, 'tests', 'tests/e2e/src')

function scaffold(argv: readonly string[]): number {
  const id = argv.find((arg) => !arg.startsWith('--'))

  if (!id) {
    console.error('e2e-spec: scaffold needs a scenario id, as in user/01-sign-up')

    return 1
  }

  const { scenarios, problems } = readScenarios(screensOf(argv))
  const scenario = scenarios.find((candidate) => candidate.id === id)

  if (problems.length > 0 || !scenario) {
    for (const problem of problems.length > 0 ? problems : [`no scenario with the id ${id}`]) {
      console.error(`e2e-spec: ${problem}`)
    }

    return 1
  }

  const target = testPathFor(testsOf(argv), id)

  if (existsSync(target)) {
    console.error(`e2e-spec: ${target} exists; not overwriting it`)

    return 1
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, scaffoldTest(scenario, { scenarioId: id }))
  console.log(`e2e-spec: wrote ${target}`)

  return 0
}

function coverage(argv: readonly string[]): number {
  const report = checkCoverage(screensOf(argv), testsOf(argv))
  const problems = [
    ...report.problems,
    ...report.missingTests.map((id) => `scenario ${id} has no test`),
    ...report.missingScenarios.map((id) => `test ${id} has no scenario`),
    ...report.wrongHeader.map((id) => `test ${id} does not start with "// scenario: ${id}"`),
    ...report.stepMismatch.map(
      (miss) =>
        `test ${miss.scenario} has ${miss.testSteps} step(s) for ${miss.steps} in its scenario`,
    ),
  ]

  for (const problem of problems) {
    console.error(`e2e-spec: ${problem}`)
  }

  if (problems.length === 0) {
    console.log('e2e-spec: every scenario has its test, step for step')
  }

  return problems.length === 0 ? 0 : 1
}

function run(argv: readonly string[]): number {
  const [command, ...rest] = argv

  switch (command) {
    case 'scaffold':
      return scaffold(rest)
    case 'coverage':
      return coverage(rest)
    default:
      console.error('e2e-spec: use "scaffold <scenario id>" or "coverage"')

      return 1
  }
}

process.exit(run(process.argv.slice(2)))
