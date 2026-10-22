/**
 * Writes a scenario as its file under `tests/e2e/scenarios`, the inverse of `parseScenario`:
 * the front matter (`tags`, `devices`, `data`, in that order), then the title, `Where:`,
 * the scenario, the numbered steps and the expected results. The id is the file's path, so
 * it is not written.
 */

import { stringify } from 'yaml'

import type { Scenario } from './schema'

export function formatScenario(scenario: Scenario): string {
  const { tags, devices, data } = scenario

  return [
    '---',
    stringify({ tags, devices, data }, { lineWidth: 0 }).trimEnd(),
    '---',
    `# ${scenario.title}`,
    '',
    `Where: ${scenario.where}`,
    '',
    `## Scenario: ${scenario.scenario}`,
    '',
    '### Steps',
    ...scenario.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '### Expected result',
    ...scenario.expected.map((result) => `- ${result}`),
    '',
  ].join('\n')
}
