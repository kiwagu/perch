import { err, ok, type Result } from 'neverthrow'

import type { SpecDoc } from './parse'

export interface ScaffoldOptions {
  /** The spec's path from the repository root, written into the test so each names the other. */
  readonly specRelPath: string
}

const quote = (text: string): string => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

/** `New name` becomes `newName`, the key of the datum and of its generator. */
const camel = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+(.)/g, (_match, next: string) => next.toUpperCase())

/**
 * The skeleton of a Playwright test for a spec: one `test.step` per spec step and
 * one failing soft assertion per expected result, so the test stays red until the
 * expectations are written (TDD at the e2e level).
 */
export function scaffoldTest(spec: SpecDoc, options: ScaffoldOptions): string {
  const fixtures = spec.role === 'guest' ? '{ page }' : '{ page, signedIn }'
  const generates = spec.testData.some((datum) => datum.generate)
  const data = spec.testData.map(
    (datum) =>
      `      ${camel(datum.name)}: ${datum.generate ? `generate.${camel(datum.name)}()` : quote(datum.value)},`,
  )
  const steps = spec.steps.flatMap((step, index) => [
    `    await test.step(${quote(`${index + 1}. ${step}`)}, async () => {`,
    `      // TODO: ${step}`,
    '    })',
    '',
  ])
  const expected = spec.expected.flatMap((result) => [
    `    // - ${result}`,
    `    expect.soft(false, ${quote(`TODO: ${result}`)}).toBe(true)`,
  ])

  return [
    `// spec: ${options.specRelPath}`,
    ...(generates ? ["import { generate } from '../support/data'"] : []),
    "import { expect, test } from '../support/fixtures'",
    '',
    `test.describe(${quote(spec.title)}, () => {`,
    `  test(${quote(spec.scenario)}, async (${fixtures}) => {`,
    ...(data.length > 0 ? ['    const data = {', ...data, '    }', ''] : []),
    ...steps,
    '    // Expected:',
    ...expected,
    '  })',
    '})',
    '',
  ].join('\n')
}

/** The test that pairs with a spec: `<root>/specs/<feature>/<name>.md` → `<root>/src/<feature>/<name>.e2e.spec.ts`. */
export function testPathFor(specPath: string): Result<string, string> {
  const match = /^(.*)\/specs\/(.+)\.md$/.exec(specPath)

  return match
    ? ok(`${match[1]}/src/${match[2]}.e2e.spec.ts`)
    : err(`not a spec under a specs/ folder: ${specPath}`)
}
