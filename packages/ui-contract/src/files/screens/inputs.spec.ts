import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { formatProblem } from '../problems'

import { loadScreens } from './load'

const FIXTURE = join(import.meta.dirname, '../../__fixtures__/contract')
const REPOSITORY = join(import.meta.dirname, '../../../../..')
const SAMPLE_FILE = 'contract/domain/screens/sample/$key.yaml'
const SAMPLE_PATH = '/sample/$key'
const KIND_SELECT = 'sample.kind-select'

let root: string

/** The sample with a kind select whose own event moves the sample's search with itself. */
function writeKindSelect(): void {
  const screen = parse(readFileSync(join(root, SAMPLE_FILE), 'utf8')) as Record<string, unknown>
  const bindings = screen['bindings'] as Array<Record<string, unknown>>
  const flow = screen['flow'] as { states: { editing: { on: Record<string, unknown> } } }

  screen['bindings'] = bindings.map((binding) => ({
    ...binding,
    search: {
      type: 'object',
      properties: { kind: { type: 'string' } },
      additionalProperties: false,
    },
  }))
  screen['anchors'] = {
    ...(screen['anchors'] as Record<string, unknown>),
    [KIND_SELECT]: { kind: 'select', binding: { search: 'kind' } },
  }
  flow.states.editing.on[KIND_SELECT] = {
    target: 'editing',
    actions: [{ navigate: { to: SAMPLE_PATH, search: { kind: { anchor: KIND_SELECT } } } }],
  }
  writeFileSync(join(root, SAMPLE_FILE), stringify(screen))
}

/** `holdsInput` of `anchor`, wherever the loaded screens declare it. */
const holdsInputOf = (screens: ReturnType<typeof loadScreens>['screens'], anchor: string) =>
  screens?.screens.find((screen) => anchor in screen.anchors)?.anchors[anchor]?.holdsInput

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-inputs-'))
  cpSync(FIXTURE, join(root, 'contract'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('whether a field holds input', () => {
  it("is derived from the flow: a select whose own event moves its screen's search with itself holds none", () => {
    writeKindSelect()

    const { screens, problems } = loadScreens(root)

    expect(problems).toEqual([])
    expect(holdsInputOf(screens, KIND_SELECT)).toBe(false)
    expect(holdsInputOf(screens, 'sample.title-input')).toBe(true)
  })

  it('is derived on the contract of the repository: a search box a button carries holds input, a select that applies at once none', () => {
    const { screens, problems } = loadScreens(REPOSITORY)

    expect(problems.map(formatProblem)).toEqual([])
    expect(holdsInputOf(screens, 'console.users.search-input')).toBe(true)
    expect(holdsInputOf(screens, 'app-shell.locale-select')).toBe(false)
  })
})
