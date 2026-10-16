import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { parseSpec } from './parse'

export interface StepMismatch {
  readonly spec: string
  readonly steps: number
  readonly testSteps: number
}

/** Specs and tests pair by name: `specs/<feature>/<nn>-<slug>.md` with `src/<feature>/<nn>-<slug>.e2e.spec.ts`. */
export interface CoverageReport {
  readonly missingTests: readonly string[]
  readonly missingSpecs: readonly string[]
  readonly stepMismatch: readonly StepMismatch[]
  readonly invalidSpecs: readonly string[]
}

const SPEC_SUFFIX = '.md'

const TEST_SUFFIX = '.e2e.spec.ts'

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

/** Paired names (`user/01-sign-up`) of the files under `dir` that end in `suffix`. */
function pairedNames(dir: string, suffix: string): Map<string, string> {
  return new Map(
    filesUnder(dir)
      .filter((path) => path.endsWith(suffix))
      .map((path) => [relative(dir, path).slice(0, -suffix.length).split(sep).join('/'), path]),
  )
}

export function checkCoverage(specsDir: string, testsDir: string): CoverageReport {
  const specs = pairedNames(specsDir, SPEC_SUFFIX)
  const tests = pairedNames(testsDir, TEST_SUFFIX)
  const invalidSpecs: string[] = []
  const stepMismatch: StepMismatch[] = []

  for (const [name, specPath] of specs) {
    const testPath = tests.get(name)
    const parsed = parseSpec(readFileSync(specPath, 'utf8'))

    if (parsed.isErr()) {
      invalidSpecs.push(name)
    } else if (testPath) {
      const testSteps = readFileSync(testPath, 'utf8').split('test.step(').length - 1

      if (testSteps < parsed.value.steps.length) {
        stepMismatch.push({ spec: name, steps: parsed.value.steps.length, testSteps })
      }
    }
  }

  return {
    missingTests: [...specs.keys()].filter((name) => !tests.has(name)).sort(),
    missingSpecs: [...tests.keys()].filter((name) => !specs.has(name)).sort(),
    stepMismatch,
    invalidSpecs: invalidSpecs.sort(),
  }
}
