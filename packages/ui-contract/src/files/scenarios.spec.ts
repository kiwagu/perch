import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { formatScenario, type Scenario } from '../scenarios'

import { SCENARIOS_DIR } from './paths'
import { loadScenarios } from './scenarios'

const FIXTURES = join(import.meta.dirname, '../__fixtures__/tests/e2e/scenarios')

const SAMPLE: Omit<Scenario, 'id'> = {
  title: 'Sign up',
  tags: ['smoke'],
  devices: { A: 'member' },
  where: '[/sample]',
  data: {},
  scenario: 'A guest signs up',
  steps: ['Open [/sample]'],
  expected: ['[sample.page] shows'],
}

let root: string

/** Writes `text` at `path` under the scenarios folder of the temporary root. */
function write(path: string, text: string): void {
  const target = join(root, SCENARIOS_DIR, path)

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
}

/** Writes the sample scenario as the file of `id`. */
const writeScenario = (id: string, change = (text: string) => text): void =>
  write(`${id}.md`, change(formatScenario({ ...SAMPLE, id })))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-scenarios-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadScenarios', () => {
  it('loads the fixture', () => {
    cpSync(FIXTURES, join(root, SCENARIOS_DIR), { recursive: true })

    const { scenarios, problems } = loadScenarios(root)

    expect(problems).toEqual([])
    expect(scenarios.map((scenario) => scenario.id)).toEqual(['sample/base/thing'])
  })
  it('takes each id from its path and sorts the scenarios by it', () => {
    for (const id of [
      'user/flows/sign-out',
      'user/base/sign-up',
      'device/base/my-devices',
      'user/base/crud/edit-name',
    ]) {
      writeScenario(id)
    }

    expect(loadScenarios(root)).toEqual({
      scenarios: [
        'device/base/my-devices',
        'user/base/crud/edit-name',
        'user/base/sign-up',
        'user/flows/sign-out',
      ].map((id) => ({ ...SAMPLE, id })),
      problems: [],
    })
  })
  it('reports a path outside the id grammar, an unknown layer and a file that is no scenario', () => {
    writeScenario('user/base/sign-up')
    write('user/01-sign-up.md', formatScenario({ ...SAMPLE, id: 'user/01-sign-up' }))
    write('user/roles/admin.md', formatScenario({ ...SAMPLE, id: 'user/roles/admin' }))
    write('user/base/notes.txt', 'Notes.\n')

    const path =
      'not a scenario path: <entity>/<layer>/[<area>/]<slug>.md in kebab-case, the layer one of base, flows, features'

    expect(loadScenarios(root)).toEqual({
      scenarios: [{ ...SAMPLE, id: 'user/base/sign-up' }],
      problems: [
        { file: 'tests/e2e/scenarios/user/01-sign-up.md', message: path },
        {
          file: 'tests/e2e/scenarios/user/base/notes.txt',
          message: 'not a scenario file: the folder holds `<id>.md` files only',
        },
        { file: 'tests/e2e/scenarios/user/roles/admin.md', message: path },
      ],
    })
  })
  it("locates a file's problems by its path and line", () => {
    writeScenario('user/base/sign-up', (text) => text.replace('  A: member', '  a: member'))

    expect(loadScenarios(root)).toEqual({
      scenarios: [],
      problems: [
        {
          file: 'tests/e2e/scenarios/user/base/sign-up.md',
          line: 4,
          message: 'devices.a: Invalid key in record',
        },
      ],
    })
  })
  it('reports a missing folder as one problem', () => {
    expect(loadScenarios(root)).toEqual({
      scenarios: [],
      problems: [{ file: 'tests/e2e/scenarios', message: 'cannot read the folder' }],
    })
  })
})
