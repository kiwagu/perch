/**
 * A throwaway repository root for the specs: the screen files and the platform file of the
 * contract fixture of `@workspace/ui-contract` under `contract/`, the scenarios a spec gives
 * it as files under `tests/e2e/scenarios/`, and test files under `tests/e2e/src/`.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  CONTRACT_DIR,
  formatScenario,
  SCENARIOS_DIR,
  type Scenario,
  scenarioFile,
} from '@workspace/ui-contract'

const FIXTURE = new URL('../../ui-contract/src/__fixtures__/contract', import.meta.url)

const TESTS_DIR = 'tests/e2e/src'

export const scenarioOf = (id: string, steps: number): Scenario => ({
  id,
  title: `The title of ${id}`,
  tags: ['smoke'],
  devices: { A: 'member' },
  where: '[/sample]',
  data: {},
  scenario: `The scenario of ${id}`,
  steps: Array.from({ length: steps }, (_, index) => `Step ${index + 1}`),
  expected: ['Done'],
})

const roots: string[] = []

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

export function project(
  scenarios: readonly Scenario[],
  tests: Readonly<Record<string, string>> = {},
): { root: string; tests: string } {
  const root = mkdtempSync(join(tmpdir(), 'e2e-spec-'))

  roots.push(root)
  mkdirSync(join(root, SCENARIOS_DIR), { recursive: true })
  cpSync(FIXTURE, join(root, CONTRACT_DIR), { recursive: true })

  for (const scenario of scenarios) {
    write(root, scenarioFile(scenario.id), formatScenario(scenario))
  }

  for (const [path, content] of Object.entries(tests)) {
    write(root, join(TESTS_DIR, path), content)
  }

  return { root, tests: join(root, TESTS_DIR) }
}

export function removeProjects(): void {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
}
