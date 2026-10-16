#!/usr/bin/env bun
/**
 * Instruction-style e2e specs.
 *
 *   e2e-spec scaffold <specs/feature/nn-name.md>
 *     writes the test skeleton to its pair, `src/feature/nn-name.e2e.spec.ts` next to
 *     `specs/`; an existing test is never overwritten.
 *   e2e-spec coverage [--specs=<dir>] [--tests=<dir>]
 *     fails when a spec has no test, a test has no spec, a spec cannot be read, or a
 *     test has fewer steps than its spec.
 *
 * Paths are relative to the current directory; the root scripts run from the
 * repository root with `tests/e2e/specs` and `tests/e2e/src`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { checkCoverage } from './coverage'
import { parseSpec } from './parse'
import { scaffoldTest, testPathFor } from './scaffold'

const readOption = (argv: readonly string[], name: string, fallback: string): string =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

function scaffold(specPath: string | undefined): number {
  if (!specPath) {
    console.error('e2e-spec: scaffold needs a spec path')

    return 1
  }

  const target = testPathFor(specPath)
  const spec = parseSpec(readFileSync(specPath, 'utf8'))

  if (target.isErr() || spec.isErr()) {
    for (const problem of [
      ...(target.isErr() ? [target.error] : []),
      ...(spec.isErr() ? spec.error : []),
    ]) {
      console.error(`e2e-spec: ${specPath}: ${problem}`)
    }

    return 1
  }

  if (existsSync(target.value)) {
    console.error(`e2e-spec: ${target.value} exists; not overwriting it`)

    return 1
  }

  mkdirSync(dirname(target.value), { recursive: true })
  writeFileSync(target.value, scaffoldTest(spec.value, { specRelPath: specPath }))
  console.log(`e2e-spec: wrote ${target.value}`)

  return 0
}

function coverage(argv: readonly string[]): number {
  const report = checkCoverage(
    readOption(argv, 'specs', 'tests/e2e/specs'),
    readOption(argv, 'tests', 'tests/e2e/src'),
  )
  const problems = [
    ...report.missingTests.map((name) => `spec ${name} has no test`),
    ...report.missingSpecs.map((name) => `test ${name} has no spec`),
    ...report.invalidSpecs.map((name) => `spec ${name} cannot be read`),
    ...report.stepMismatch.map(
      (miss) => `test ${miss.spec} has ${miss.testSteps} step(s) for ${miss.steps} in its spec`,
    ),
  ]

  for (const problem of problems) {
    console.error(`e2e-spec: ${problem}`)
  }

  if (problems.length === 0) {
    console.log('e2e-spec: every spec has its test, step for step')
  }

  return problems.length === 0 ? 0 : 1
}

function run(argv: readonly string[]): number {
  const [command, ...rest] = argv

  switch (command) {
    case 'scaffold':
      return scaffold(rest[0])
    case 'coverage':
      return coverage(rest)
    default:
      console.error('e2e-spec: use "scaffold <spec.md>" or "coverage"')

      return 1
  }
}

process.exit(run(process.argv.slice(2)))
