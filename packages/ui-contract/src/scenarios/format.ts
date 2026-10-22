/**
 * Writes a scenario as its file under `tests/e2e/scenarios`, the inverse of `parseScenario`:
 * the front matter (`tags`, the `activity` when it has one, `devices`, `data`, in that
 * order), then the title, `Where:`, the scenario, the numbered steps and the expected
 * results. The id is the file's path, so it is not written.
 */

import { stringify } from 'yaml'

import type { Scenario } from './schema'

export function formatScenario(scenario: Scenario): string {
  const { tags, activity, devices, data } = scenario
  const header = { tags, ...(activity === undefined ? {} : { activity }), devices, data }

  return [
    '---',
    stringify(header, { lineWidth: 0 }).trimEnd(),
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
