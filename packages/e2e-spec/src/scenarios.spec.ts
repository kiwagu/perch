import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SCENARIOS_DIR } from '@workspace/ui-contract'

import { project, removeProjects, scenarioOf } from './project.fixture'
import { readScenarios } from './scenarios'

afterEach(removeProjects)

describe('readScenarios', () => {
  it('returns the scenarios of the folder, sorted by their paths', () => {
    const edit = scenarioOf('sample/base/edit', 2)
    const remove = scenarioOf('sample/base/delete', 3)
    const { root } = project([edit, remove])

    expect(readScenarios(root)).toEqual({ scenarios: [remove, edit], problems: [] })
  })

  it('reports a missing folder', () => {
    const { root } = project([])

    rmSync(join(root, SCENARIOS_DIR), { recursive: true })
    expect(readScenarios(root)).toEqual({
      scenarios: [],
      problems: ['tests/e2e/scenarios:1: cannot read the folder'],
    })
  })

  it('reports a scenario file by its path and line', () => {
    const { root } = project([{ ...scenarioOf('sample/base/edit', 1), steps: [] }])

    expect(readScenarios(root)).toEqual({
      scenarios: [],
      problems: [
        expect.stringMatching(/^tests\/e2e\/scenarios\/sample\/base\/edit\.md:\d+: steps: /),
      ],
    })
  })
})
