import { join } from 'node:path'

import type { Scenario } from '@workspace/ui-contract'

export interface ScaffoldOptions {
  /** The scenario's id, written into the test's first line so each names the other. */
  readonly scenarioId: string
}

const GENERATE = 'generate'

const quote = (text: string): string => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

/** `New name` becomes `newName`, the key of the datum and of its generator. */
const camel = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+(.)/g, (_match, next: string) => next.toUpperCase())

/** A single guest browser starts on a bare page; any other scenario starts signed in. */
const fixturesOf = (devices: Scenario['devices']): string => {
  const roles = Object.values(devices)

  return roles.length === 1 && roles[0] === 'guest' ? '{ page }' : '{ page, signedIn }'
}

/**
 * The skeleton of a Playwright test for a scenario: one `test.step` per step and one
 * failing soft assertion per expected result, so the test stays red until the
 * expectations are written (TDD at the e2e level).
 */
export function scaffoldTest(scenario: Scenario, options: ScaffoldOptions): string {
  const entries = Object.entries(scenario.data)
  const generates = entries.some(([, value]) => value === GENERATE)
  const data = entries.map(
    ([name, value]) =>
      `      ${camel(name)}: ${value === GENERATE ? `generate.${camel(name)}()` : quote(value)},`,
  )
  const steps = scenario.steps.flatMap((step, index) => [
    `    await test.step(${quote(`${index + 1}. ${step}`)}, async () => {`,
    `      // TODO: ${step}`,
    '    })',
    '',
  ])
  const expected = scenario.expected.flatMap((result) => [
    `    // - ${result}`,
    `    expect.soft(false, ${quote(`TODO: ${result}`)}).toBe(true)`,
  ])

  return [
    `// scenario: ${options.scenarioId}`,
    ...(generates ? ["import { generate } from '../support/data'"] : []),
    "import { expect, test } from '../support/fixtures'",
    '',
    `test.describe(${quote(scenario.title)}, () => {`,
    `  test(${quote(scenario.scenario)}, async (${fixturesOf(scenario.devices)}) => {`,
    ...(data.length > 0 ? ['    const data = {', ...data, '    }', ''] : []),
    ...steps,
    '    // Expected:',
    ...expected,
    '  })',
    '})',
    '',
  ].join('\n')
}

/** The test that pairs with a scenario: `<testsDir>/<id>.e2e.spec.ts`. */
export const testPathFor = (testsDir: string, scenarioId: string): string =>
  join(testsDir, `${scenarioId}.e2e.spec.ts`)
