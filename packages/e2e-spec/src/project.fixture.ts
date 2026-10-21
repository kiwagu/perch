/**
 * A throwaway repository root for the specs: `contract/screens.json` (the contract fixture
 * of `@workspace/ui-contract` with the scenarios a spec gives it) and test files under
 * `tests/`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Scenario } from '@workspace/ui-contract'

const FIXTURE = new URL('../../ui-contract/src/__fixtures__/screens.json', import.meta.url)

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

export function project(
  scenarios: readonly Scenario[],
  tests: Readonly<Record<string, string>> = {},
): { screens: string; tests: string } {
  const root = mkdtempSync(join(tmpdir(), 'e2e-spec-'))
  const screens = join(root, 'contract', 'screens.json')
  const contract = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>

  roots.push(root)
  mkdirSync(join(root, 'contract'))
  writeFileSync(screens, JSON.stringify({ ...contract, scenarios }))

  for (const [path, content] of Object.entries(tests)) {
    mkdirSync(join(root, 'tests', path, '..'), { recursive: true })
    writeFileSync(join(root, 'tests', path), content)
  }

  return { screens, tests: join(root, 'tests') }
}

export function removeProjects(): void {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
}
