import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { project, removeProjects, scenarioOf } from './project.fixture'
import { readScenarios } from './scenarios'

afterEach(removeProjects)

describe('readScenarios', () => {
  it('returns the scenarios of the screens file', () => {
    const scenarios = [scenarioOf('sample/01-edit', 2), scenarioOf('sample/02-delete', 3)]
    const { screens } = project(scenarios)

    expect(readScenarios(screens)).toEqual({ scenarios, problems: [] })
  })

  it('reports a path that is not contract/screens.json and a file it cannot read', () => {
    const { screens } = project([])

    expect(readScenarios(screens.replace('screens.json', 'other.json'))).toEqual({
      scenarios: [],
      problems: [expect.stringContaining('is not contract/screens.json')],
    })
    rmSync(screens)
    expect(readScenarios(screens)).toEqual({
      scenarios: [],
      problems: ['contract/screens.json:1: cannot read the file'],
    })
  })

  it('reports a scenario that breaks the schema of the file', () => {
    const { screens } = project([{ ...scenarioOf('sample/01-edit', 1), steps: [] }])

    expect(readScenarios(screens).problems).toEqual([
      expect.stringMatching(/^contract\/screens\.json:\d+: /),
    ])
  })
})
