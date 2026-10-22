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
    const dirs = project([scenarioOf('user/base/a', 2)], {
      'user/base/a.e2e.spec.ts': test('user/base/a', 2),
      'support/fixtures.ts': 'export {}',
    })

    expect(checkCoverage(dirs.root, dirs.tests)).toEqual({
      missingTests: [],
      missingScenarios: [],
      stepMismatch: [],
      wrongHeader: [],
      problems: [],
    })
  })

  it('reports a scenario without a test, a test without a scenario and a test with too few steps', () => {
    const dirs = project([scenarioOf('user/base/a', 4), scenarioOf('user/base/b', 1)], {
      'user/base/a.e2e.spec.ts': test('user/base/a', 3),
      'user/base/c.e2e.spec.ts': test('user/base/c', 1),
    })

    expect(checkCoverage(dirs.root, dirs.tests)).toEqual({
      missingTests: ['user/base/b'],
      missingScenarios: ['user/base/c'],
      stepMismatch: [{ scenario: 'user/base/a', steps: 4, testSteps: 3 }],
      wrongHeader: [],
      problems: [],
    })
  })

  it('does not count steps that are commented out', () => {
    const dirs = project([scenarioOf('user/base/a', 4)], {
      'user/base/a.e2e.spec.ts': [
        test('user/base/a', 2),
        "// await test.step('3. x', fn)",
        "/* await test.step('4. x', fn) */",
      ].join('\n'),
    })

    expect(checkCoverage(dirs.root, dirs.tests).stepMismatch).toEqual([
      { scenario: 'user/base/a', steps: 4, testSteps: 2 },
    ])
  })

  it('reports a test whose first line names another scenario', () => {
    const dirs = project([scenarioOf('user/base/a', 1)], {
      'user/base/a.e2e.spec.ts': test('user/base/z', 1),
    })

    expect(checkCoverage(dirs.root, dirs.tests).wrongHeader).toEqual(['user/base/a'])
  })

  it('reports a scenario file it cannot read', () => {
    const dirs = project([{ ...scenarioOf('user/base/a', 1), steps: [] }])

    expect(checkCoverage(dirs.root, dirs.tests).problems).toHaveLength(1)
  })
})
