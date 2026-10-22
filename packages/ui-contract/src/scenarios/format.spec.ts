import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatScenario } from './format'
import { parseScenario } from './parse'
import type { Scenario } from './schema'

const FIXTURES = join(import.meta.dirname, '../__fixtures__/tests/e2e/scenarios')
const REPOSITORY = join(import.meta.dirname, '../../../../tests/e2e/scenarios')

/** The scenario files under `dir`, each as its id and its text. */
const filesUnder = (dir: string): Array<[string, string]> =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .sort()
    .map((path) => [
      path.slice(0, -'.md'.length).split(sep).join('/'),
      readFileSync(join(dir, path), 'utf8'),
    ])

/** The scenario of a file that parses without problems. */
function parsed(id: string, markdown: string): Scenario {
  const { scenario, problems } = parseScenario(id, markdown)

  expect(problems).toEqual([])

  if (scenario === undefined) {
    throw new Error(`${id} does not parse`)
  }

  return scenario
}

const ODD: Scenario = {
  id: 'organisation/flows/edit-own',
  title: "Edit one's own note",
  tags: ['full', 'smoke'],
  devices: { A: 'admin', B: 'member' },
  where: 'The page at [/org], then [organisation.notes.section]',
  data: {
    'Idle minutes': '10',
    "Key of C's organisation": 'generate',
    'Note by B, edited by A': 'generate',
    Flag: 'true',
    Empty: '',
  },
  scenario: 'A member edits: only its own notes, # never another',
  steps: ['Open [/org]', '- not a bullet, a step', '2. not a number either'],
  expected: ['[organisation.notes.item] shows the text', '### not a heading'],
}

describe('formatScenario', () => {
  it('writes the fixture as it is written', () => {
    const [[id, text] = ['', '']] = filesUnder(FIXTURES)

    expect(formatScenario(parsed(id, text))).toBe(text)
  })
  it('writes the header keys in order, an empty data as {}', () => {
    expect(formatScenario({ ...ODD, tags: ['smoke'], devices: { A: 'guest' }, data: {} })).toMatch(
      /^---\ntags:\n {2}- smoke\ndevices:\n {2}A: guest\ndata: \{\}\n---\n# Edit one's own note\n\nWhere: /,
    )
  })
  it('writes the activity after the tags, and nothing for a scenario without one', () => {
    expect(formatScenario({ ...ODD, tags: ['full'], activity: 'session' })).toMatch(
      /^---\ntags:\n {2}- full\nactivity: session\ndevices:\n/,
    )
    expect(formatScenario(ODD)).not.toContain('activity')
  })
  it('is undone by the parser for values YAML and Markdown would read otherwise', () => {
    expect(parsed(ODD.id, formatScenario(ODD))).toEqual(ODD)
  })
  it.each(filesUnder(REPOSITORY))('is undone by the parser for %s', (id, text) => {
    const scenario = parsed(id, text)

    expect(parsed(id, formatScenario(scenario))).toEqual(scenario)
  })
})
