import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { parseSync, Visitor } from 'oxc-parser'

import { readScenarios } from './scenarios'

export interface StepMismatch {
  readonly scenario: string
  readonly steps: number
  readonly testSteps: number
}

/**
 * Scenarios and tests pair by id: the scenario `user/01-sign-up` of `contract/screens.json`
 * with `<testsDir>/user/01-sign-up.e2e.spec.ts`, whose first line is
 * `// scenario: user/01-sign-up`.
 */
export interface CoverageReport {
  readonly missingTests: readonly string[]
  readonly missingScenarios: readonly string[]
  readonly stepMismatch: readonly StepMismatch[]
  /** Paired tests whose first line is not `// scenario: <id>`. */
  readonly wrongHeader: readonly string[]
  /** The screens file could not be read: `file:line: message`. */
  readonly problems: readonly string[]
}

const TEST_SUFFIX = '.e2e.spec.ts'

const headerOf = (id: string): string => `// scenario: ${id}`

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

/**
 * The `test.step(...)` calls in a test file's code; comments and strings do not
 * count. A static count: it cannot tell a step that runs from one that never does.
 */
function countSteps(path: string, source: string): number {
  const { program } = parseSync(path, source, { lang: 'ts', sourceType: 'module' })
  let steps = 0

  new Visitor({
    CallExpression(node) {
      const callee = node.callee

      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'test' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'step'
      ) {
        steps += 1
      }
    },
  }).visit(program)

  return steps
}

/** The tests under `dir` by the id they pair with (`user/01-sign-up`). */
function testsById(dir: string): Map<string, string> {
  return new Map(
    filesUnder(dir)
      .filter((path) => path.endsWith(TEST_SUFFIX))
      .map((path) => [
        relative(dir, path).slice(0, -TEST_SUFFIX.length).split(sep).join('/'),
        path,
      ]),
  )
}

export function checkCoverage(screensPath: string, testsDir: string): CoverageReport {
  const { scenarios, problems } = readScenarios(screensPath)
  const tests = testsById(testsDir)
  const ids = new Set(scenarios.map((scenario) => scenario.id))
  const stepMismatch: StepMismatch[] = []
  const wrongHeader: string[] = []

  for (const scenario of scenarios) {
    const testPath = tests.get(scenario.id)

    if (testPath) {
      const source = readFileSync(testPath, 'utf8')
      const testSteps = countSteps(testPath, source)

      if (source.split('\n', 1)[0]?.trim() !== headerOf(scenario.id)) {
        wrongHeader.push(scenario.id)
      }

      if (testSteps < scenario.steps.length) {
        stepMismatch.push({ scenario: scenario.id, steps: scenario.steps.length, testSteps })
      }
    }
  }

  return {
    missingTests: [...ids].filter((id) => !tests.has(id)).sort(),
    missingScenarios:
      problems.length > 0 ? [] : [...tests.keys()].filter((id) => !ids.has(id)).sort(),
    stepMismatch,
    wrongHeader: wrongHeader.sort(),
    problems,
  }
}
