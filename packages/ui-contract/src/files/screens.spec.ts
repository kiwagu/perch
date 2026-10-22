import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SCREENS_FILE } from './paths'
import { loadScreens } from './screens'
import { jsonSchemaProblems } from './validator'

const FIXTURE = join(import.meta.dirname, '../__fixtures__/screens.json')

let root: string

const fixture = (): Record<string, unknown> =>
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>

/** The fixture with `change` applied to its first screen, written to the temporary root. */
function writeScreen(change: (screen: Record<string, unknown>) => void): void {
  const file = fixture()
  const [screen] = file['screens'] as Record<string, unknown>[]

  if (screen) {
    change(screen)
  }

  writeFileSync(join(root, SCREENS_FILE), JSON.stringify(file))
}

const messages = (): string[] => loadScreens(root).problems.map((problem) => problem.message)

/** The one problem the file has. */
function onlyMessage(): string {
  const found = messages()

  expect(found).toHaveLength(1)

  return found[0] ?? ''
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-screens-'))
  mkdirSync(join(root, 'contract'))
  cpSync(FIXTURE, join(root, SCREENS_FILE))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadScreens', () => {
  it('loads the fixture', () => {
    const { screens, problems } = loadScreens(root)

    expect(problems).toEqual([])
    expect(screens?.screens.map((screen) => screen.id)).toEqual(['sample'])
    expect(screens?.platform.actions['sign-out']?.codes).toEqual(['failed'])

    const anchors = screens?.screens[0]?.anchors

    expect(anchors?.['sample.save-button']?.binding).toHaveLength(2)
    expect(anchors?.['sample.sign-out-button']?.binding).toEqual({
      action: 'platform.sign-out',
      params: { forgetUnsent: { value: true } },
    })
    expect(screens?.screens[0]?.flow?.events[0]?.params).toEqual({ title: 'sample.title-input' })
  })
  it('defaults the history of a binding to push', () => {
    expect(loadScreens(root).screens?.screens[0]?.bindings[0]?.history).toBe('push')
  })
  it('reports a screen without entry by its path', () => {
    writeScreen((screen) => {
      delete screen['entry']
    })

    expect(messages()).toEqual([
      'screens[0].entry: Invalid input: expected array, received undefined',
    ])
  })
  it('reports an anchor key that breaks the grammar', () => {
    writeScreen((screen) => {
      screen['anchors'] = { 'Sample.Bad_Key': { kind: 'button' } }
    })

    expect(onlyMessage()).toMatch(/^screens\[0\]\.anchors\["Sample\.Bad_Key"\]: /)
  })
  it('reports a binding path without a leading slash', () => {
    writeScreen((screen) => {
      screen['bindings'] = [{ path: 'sample', roles: ['member'] }]
    })

    expect(onlyMessage()).toMatch(/^screens\[0\]\.bindings\[0\]\.path: Invalid string/)
  })
  it('reports a search parameter of type object', () => {
    writeScreen((screen) => {
      screen['bindings'] = [
        {
          path: '/sample',
          roles: ['member'],
          search: {
            type: 'object',
            properties: { filter: { type: 'object' } },
            additionalProperties: false,
          },
        },
      ]
    })

    expect(onlyMessage()).toMatch(
      /^screens\[0\]\.bindings\[0\]\.search\.properties\.filter\.type: Invalid option/,
    )
  })
  it('accepts route parameters that are, as written, a JSON Schema 2020-12', () => {
    const search = {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          enum: ['all', 'mine'],
          default: 'all',
          description: 'The tab of the list.',
          'x-perch': {
            control: 'sample.tab-select',
            values: { mine: { control: 'sample.mine-tab', controlValue: 'mine' } },
          },
        },
      },
      required: ['tab'],
      additionalProperties: false,
    }

    writeScreen((screen) => {
      screen['bindings'] = [{ path: '/sample/$id/{-$part}', roles: ['member'], search }]
    })

    expect(loadScreens(root).problems).toEqual([])
    expect(jsonSchemaProblems(SCREENS_FILE, search)).toEqual([])
  })
  it('reports a routed screen without bindings', () => {
    writeScreen((screen) => {
      screen['bindings'] = []
    })

    expect(messages()).toEqual([
      'screens[0].bindings: a screen that is not the frame needs at least one binding',
    ])
  })
  it('reports a file that is not JSON', () => {
    writeFileSync(join(root, SCREENS_FILE), '{ "version": 1,')

    expect(loadScreens(root).screens).toBeUndefined()
    expect(onlyMessage()).toMatch(/^not JSON: /)
  })
})
