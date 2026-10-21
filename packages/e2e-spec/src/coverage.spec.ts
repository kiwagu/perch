import { afterEach, describe, expect, it } from 'vitest'

import { checkCoverage } from './coverage'
import { project, removeProjects, scenarioOf } from './project.fixture'

const test = (id: string, steps: number) =>
  [
    `// scenario: ${id}`,
    ...Array.from({ length: steps }, (_, index) => `await test.step('${index + 1}. x', fn)`),
  ].join('\n')

afterEach(removeProjects)

describe('checkCoverage', () => {
  it('passes when every scenario has its test with a step per scenario step', () => {
    const dirs = project([scenarioOf('user/01-a', 2)], {
      'user/01-a.e2e.spec.ts': test('user/01-a', 2),
      'support/fixtures.ts': 'export {}',
    })

    expect(checkCoverage(dirs.screens, dirs.tests)).toEqual({
      missingTests: [],
      missingScenarios: [],
      stepMismatch: [],
      wrongHeader: [],
      problems: [],
    })
  })

  it('reports a scenario without a test, a test without a scenario and a test with too few steps', () => {
    const dirs = project([scenarioOf('user/01-a', 4), scenarioOf('user/02-b', 1)], {
      'user/01-a.e2e.spec.ts': test('user/01-a', 3),
      'user/03-c.e2e.spec.ts': test('user/03-c', 1),
    })

    expect(checkCoverage(dirs.screens, dirs.tests)).toEqual({
      missingTests: ['user/02-b'],
      missingScenarios: ['user/03-c'],
      stepMismatch: [{ scenario: 'user/01-a', steps: 4, testSteps: 3 }],
      wrongHeader: [],
      problems: [],
    })
  })

  it('does not count steps that are commented out', () => {
    const dirs = project([scenarioOf('user/01-a', 4)], {
      'user/01-a.e2e.spec.ts': [
        test('user/01-a', 2),
        "// await test.step('3. x', fn)",
        "/* await test.step('4. x', fn) */",
      ].join('\n'),
    })

    expect(checkCoverage(dirs.screens, dirs.tests).stepMismatch).toEqual([
      { scenario: 'user/01-a', steps: 4, testSteps: 2 },
    ])
  })

  it('reports a test whose first line names another scenario', () => {
    const dirs = project([scenarioOf('user/01-a', 1)], {
      'user/01-a.e2e.spec.ts': test('user/09-z', 1),
    })

    expect(checkCoverage(dirs.screens, dirs.tests).wrongHeader).toEqual(['user/01-a'])
  })

  it('reports a screens file it cannot read', () => {
    const dirs = project([{ ...scenarioOf('user/01-a', 1), steps: [] }])

    expect(checkCoverage(dirs.screens, dirs.tests).problems).toHaveLength(1)
  })
})
