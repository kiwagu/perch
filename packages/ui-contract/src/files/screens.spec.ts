import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { MODEL_FILE, PLATFORM_FILE, SCREENS_DIR } from './paths'
import { formatProblem } from './problems'
import { loadScreens } from './screens'
import { jsonSchemaProblems } from './validator'

const FIXTURE = join(import.meta.dirname, '../__fixtures__/contract')
const MODEL_FIXTURE = join(import.meta.dirname, '../__fixtures__/model.schema.json')
const SAMPLE_FILE = 'contract/domain/screens/sample/$key.yaml'

let root: string

/** Writes `text` at `file`, relative to the temporary root. */
function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

/** The fixture's screen with `change` applied, written back to its file. */
function writeSample(change: (screen: Record<string, unknown>) => void): void {
  const screen = parse(readFileSync(join(root, SAMPLE_FILE), 'utf8')) as Record<string, unknown>

  change(screen)
  write(SAMPLE_FILE, stringify(screen))
}

/** A screen with one page anchor, bound to `path`, or the frame without a binding. */
const screenAt = (id: string, path?: string): string =>
  stringify({
    id,
    title: `The ${id} screen`,
    description: `What the ${id} screen is for.`,
    ...(path === undefined ? { frame: true } : {}),
    flag: null,
    bindings: path === undefined ? [] : [{ path, roles: ['member'] }],
    entry: [`${id}.page`],
    anchors: { [`${id}.page`]: { kind: 'page' } },
  })

const problems = () => loadScreens(root).problems

const messages = (): string[] => problems().map((problem) => problem.message)

/** The one problem the files have. */
function onlyMessage(): string {
  const found = messages()

  expect(found).toHaveLength(1)

  return found[0] ?? ''
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-screens-'))
  cpSync(FIXTURE, join(root, 'contract'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadScreens', () => {
  it('loads the fixture: its screens with their files, the version and the platform', () => {
    const { screens, problems: found } = loadScreens(root)

    expect(found).toEqual([])
    expect(screens?.version).toBe(1)
    expect(screens?.screens.map((screen) => screen.id)).toEqual(['sample'])
    expect(screens?.files).toEqual([SAMPLE_FILE])
    expect(screens?.platform.actions['sign-out']?.codes).toEqual(['failed'])

    const anchors = screens?.screens[0]?.anchors

    expect(anchors?.['sample.save-button']?.binding).toHaveLength(2)
    expect(anchors?.['sample.sign-out-button']?.binding).toEqual({
      action: 'platform.sign-out',
      params: { forgetUnsent: { value: true } },
    })
    const saving = screens?.screens[0]?.flow?.states['saving']

    expect(saving?.type !== 'parallel' && saving?.invoke?.input).toEqual({
      title: 'sample.title-input',
    })
  })
  it('refuses a screen without a description of what it is for', () => {
    writeSample((screen) => {
      delete screen['description']
    })

    expect(onlyMessage()).toContain('description')
  })
  it('defaults the history of a binding to push', () => {
    expect(loadScreens(root).screens?.screens[0]?.bindings[0]?.history).toBe('push')
  })
  it('reads the folder at any depth, sorted by path, the frame first', () => {
    write('contract/domain/screens/sign-in.yaml', screenAt('user.sign-in', '/sign-in'))
    write('contract/domain/screens/org/$org.yaml', screenAt('organisation.one', '/org/$org'))
    write('contract/domain/screens/org.yaml', screenAt('organisation', '/org'))
    write('contract/domain/screens/me.yaml', screenAt('user.profile', '/me'))
    write('contract/domain/screens/__root.yaml', screenAt('app-shell'))
    write('contract/domain/screens/index.yaml', screenAt('home', '/'))

    const { screens, problems: found } = loadScreens(root)

    expect(found).toEqual([])
    expect(screens?.files).toEqual([
      'contract/domain/screens/__root.yaml',
      'contract/domain/screens/index.yaml',
      'contract/domain/screens/me.yaml',
      'contract/domain/screens/org.yaml',
      'contract/domain/screens/org/$org.yaml',
      SAMPLE_FILE,
      'contract/domain/screens/sign-in.yaml',
    ])
    expect(screens?.screens.map((screen) => screen.id)).toEqual([
      'app-shell',
      'home',
      'user.profile',
      'organisation',
      'organisation.one',
      'sample',
      'user.sign-in',
    ])
  })
  it('reports a file not named by the first binding of its screen', () => {
    write('contract/domain/screens/profile.yaml', screenAt('user.profile', '/me'))
    write('contract/domain/screens/org.yaml', screenAt('organisation.one', '/org/$org'))

    expect(problems()).toEqual([
      {
        file: 'contract/domain/screens/org.yaml',
        message:
          'its first binding is "/org/$org", so its file is contract/domain/screens/org/$org.yaml',
      },
      {
        file: 'contract/domain/screens/profile.yaml',
        message: 'its first binding is "/me", so its file is contract/domain/screens/me.yaml',
      },
    ])
  })
  it('reports a second screen without bindings: the one frame is __root.yaml', () => {
    write('contract/domain/screens/__root.yaml', screenAt('app-shell'))
    write('contract/domain/screens/frame.yaml', screenAt('frame'))

    expect(problems()).toEqual([
      {
        file: 'contract/domain/screens/frame.yaml',
        message:
          'a screen without bindings is the frame, whose file is contract/domain/screens/__root.yaml',
      },
    ])
  })
  it('reports a file that is not a screen file', () => {
    write('contract/domain/screens/me.yml', screenAt('user.profile', '/me'))
    write('contract/domain/screens/sample/notes.txt', 'Notes.\n')

    expect(problems()).toEqual([
      {
        file: 'contract/domain/screens/me.yml',
        message: 'not a screen file: the folder holds `<pathname>.yaml` files only',
      },
      {
        file: 'contract/domain/screens/sample/notes.txt',
        message: 'not a screen file: the folder holds `<pathname>.yaml` files only',
      },
    ])
  })
  it('reports a missing folder, an empty one and a missing platform file', () => {
    rmSync(join(root, SCREENS_DIR), { recursive: true })
    rmSync(join(root, PLATFORM_FILE))

    expect(loadScreens(root)).toEqual({
      problems: [
        { file: 'contract/domain/screens', message: 'cannot read the folder' },
        { file: 'contract/domain/platform.yaml', message: 'cannot read the file' },
      ],
    })

    mkdirSync(join(root, SCREENS_DIR))

    expect(problems()).toEqual([
      { file: 'contract/domain/screens', message: 'holds no screen file' },
      { file: 'contract/domain/platform.yaml', message: 'cannot read the file' },
    ])
  })
  it('locates each problem in the file that holds it, by its path there', () => {
    writeSample((screen) => {
      delete screen['entry']
    })
    write(
      PLATFORM_FILE,
      readFileSync(join(root, PLATFORM_FILE), 'utf8').replace('version: 1', 'version: one'),
    )

    expect(problems()).toEqual([
      { file: SAMPLE_FILE, message: 'entry: Invalid input: expected array, received undefined' },
      { file: 'contract/domain/platform.yaml', message: 'version: Invalid input: expected 1' },
    ])
  })
  it('reports an anchor key that breaks the grammar', () => {
    writeSample((screen) => {
      screen['anchors'] = { 'Sample.Bad_Key': { kind: 'button' } }
    })

    expect(onlyMessage()).toMatch(/^anchors\["Sample\.Bad_Key"\]: /)
  })
  it('reports a binding path without a leading slash', () => {
    writeSample((screen) => {
      screen['bindings'] = [{ path: 'sample', roles: ['member'] }]
    })

    expect(onlyMessage()).toMatch(/^bindings\[0\]\.path: Invalid string/)
  })
  it('reports a search parameter of type object', () => {
    writeSample((screen) => {
      screen['bindings'] = [
        {
          path: '/sample/$key',
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
      /^bindings\[0\]\.search\.properties\.filter\.type: Invalid option/,
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

    writeSample((screen) => {
      screen['bindings'] = [{ path: '/sample/$key', roles: ['member'], search }]
    })

    expect(problems()).toEqual([])
    expect(jsonSchemaProblems(SAMPLE_FILE, search)).toEqual([])
  })
  it('reports a routed screen without bindings', () => {
    writeSample((screen) => {
      screen['bindings'] = []
    })

    expect(messages()).toEqual([
      'bindings: a screen that is not the frame needs at least one binding',
    ])
  })
  it('reports a file that is not YAML at its line', () => {
    write(SAMPLE_FILE, 'id: sample\ntitle: [One thing,\nflag: null\n')

    const { screens, problems: found } = loadScreens(root)

    expect(screens).toBeUndefined()
    expect(found.map(formatProblem)).toEqual([
      expect.stringMatching(
        /^contract\/domain\/screens\/sample\/\$key\.yaml:3: not YAML: Flow sequence in block collection/,
      ),
    ])
  })
  it('loads a flow written in the shorter forms as the flow every reader takes', () => {
    const before = loadScreens(root).screens?.screens[0]?.flow

    writeSample((screen) => {
      screen['flow'] = {
        initial: 'editing',
        states: {
          editing: { on: { 'sample.save-button': 'saving' } },
          saving: {
            invoke: {
              src: 'thing.updateThing',
              input: { title: 'sample.title-input' },
              onDone: {
                target: 'editing',
                actions: [
                  { show: { 'sample.save-button': ['saved'] } },
                  { navigate: '/sample/$key' },
                ],
              },
              onError: {
                target: 'editing',
                actions: [{ show: { 'sample.save-button': ['failed'] } }],
              },
            },
          },
        },
      }
    })

    const { screens, problems: found } = loadScreens(root)

    expect(found).toEqual([])
    expect(screens?.screens[0]?.flow).toEqual(before)
  })

  it('derives what a screen leaves out from the model: an error and the region of a button', () => {
    cpSync(MODEL_FIXTURE, join(root, MODEL_FILE))
    writeSample((screen) => {
      const { 'sample.sign-out-button': _signOut, ...anchors } = screen['anchors'] as Record<
        string,
        unknown
      >

      screen['anchors'] = {
        ...anchors,
        'sample.form.title-input': { kind: 'input', binding: { model: 'thing.title' } },
        'sample.form.add-button': {
          kind: 'button',
          binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
        },
        'sample.form.error': { kind: 'error' },
      }
      screen['flow'] = {
        initial: 'viewing',
        states: {
          viewing: {
            type: 'parallel',
            states: { other: { initial: 'idle', states: { idle: {} } } },
          },
        },
      }
    })

    const { screens, problems: found } = loadScreens(root)
    const sample = screens?.screens[0]

    expect(found).toEqual([])
    expect(sample?.anchors['sample.form.error']).toEqual({
      kind: 'error',
      codes: ['forbidden', 'title-required', 'title-too-long', 'title-taken', 'failed'],
      fields: {
        'title-required': 'sample.form.title-input',
        'title-too-long': 'sample.form.title-input',
        'title-taken': 'sample.form.title-input',
      },
    })
    expect(sample?.anchors['sample.form.title-input']?.holdsInput).toBe(true)
    expect(sample?.flow?.states['viewing']).toMatchObject({
      states: {
        'form-add': {
          states: {
            running: {
              invoke: {
                src: 'thing.createThing',
                onError: {
                  actions: [
                    {
                      type: 'show',
                      params: {
                        anchor: 'sample.form.error',
                        codes: [
                          'forbidden',
                          'title-required',
                          'title-too-long',
                          'title-taken',
                          'failed',
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    })
  })

  describe('the toast of a model action', () => {
    /** The frame with a toast anchor, and the sample screen whose add button runs `thing.createThing`. */
    function writeToastScreens(regions: Record<string, unknown>): void {
      cpSync(MODEL_FIXTURE, join(root, MODEL_FILE))
      write(
        'contract/domain/screens/__root.yaml',
        stringify({
          ...(parse(screenAt('app-shell')) as Record<string, unknown>),
          anchors: { 'app-shell.page': { kind: 'page' }, 'app-shell.toast': { kind: 'toast' } },
        }),
      )
      writeSample((screen) => {
        const { 'sample.sign-out-button': _signOut, ...anchors } = screen['anchors'] as Record<
          string,
          unknown
        >

        screen['anchors'] = {
          ...anchors,
          'sample.form.title-input': { kind: 'input', binding: { model: 'thing.title' } },
          'sample.form.add-button': {
            kind: 'button',
            binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
          },
          'sample.form.error': { kind: 'error' },
        }
        screen['flow'] = {
          initial: 'viewing',
          states: {
            viewing: {
              type: 'parallel',
              states: { other: { initial: 'idle', states: { idle: {} } }, ...regions },
            },
          },
        }
      })
    }

    it('is derived on the frame toast anchor, which carries its code', () => {
      writeToastScreens({})

      const { screens, problems: found } = loadScreens(root)
      const frame = screens?.screens.find((screen) => screen.id === 'app-shell')
      const sample = screens?.screens.find((screen) => screen.id === 'sample')

      expect(found.map(formatProblem)).toEqual([])
      expect(frame?.anchors['app-shell.toast']?.codes).toEqual(['thing-created'])
      expect(screens?.toasts).toEqual([
        { anchor: 'app-shell.toast', code: 'thing-created', action: 'thing.createThing' },
      ])
      expect(sample?.flow?.states['viewing']).toMatchObject({
        states: {
          'form-add': {
            states: {
              running: {
                invoke: {
                  onDone: {
                    actions: [
                      {
                        type: 'show',
                        params: { anchor: 'app-shell.toast', codes: ['thing-created'] },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      })
    })

    it('is not derived for a region by its button that says toast: false', () => {
      writeToastScreens({ add: { by: 'sample.form.add-button', toast: false } })

      const { screens, problems: found } = loadScreens(root)
      const frame = screens?.screens.find((screen) => screen.id === 'app-shell')

      expect(found.map(formatProblem)).toEqual([])
      expect(screens?.toasts).toEqual([])
      expect(frame?.anchors['app-shell.toast']?.codes).toBeUndefined()
    })
  })

  it('says a field whose own change runs its action holds no input, and keeps a written value', () => {
    writeSample((screen) => {
      screen['anchors'] = {
        ...(screen['anchors'] as Record<string, unknown>),
        'sample.kind-select': {
          kind: 'select',
          binding: { action: 'platform.sign-out', params: { forgetUnsent: 'sample.kind-select' } },
        },
        'sample.title-input': {
          kind: 'input',
          binding: { model: 'thing.title' },
          holdsInput: false,
        },
      }
    })

    const anchors = loadScreens(root).screens?.screens[0]?.anchors

    expect(anchors?.['sample.kind-select']?.holdsInput).toBe(false)
    expect(anchors?.['sample.title-input']?.holdsInput).toBe(false)
    expect(anchors?.['sample.save-button']?.holdsInput).toBeUndefined()
  })

  it('counts the derived regions among the two a parallel state has, after the expansion', () => {
    cpSync(MODEL_FIXTURE, join(root, MODEL_FILE))

    const withRegions = (states: Record<string, unknown>, buttons: Record<string, unknown>) =>
      writeSample((screen) => {
        const anchors = Object.fromEntries(
          Object.entries(screen['anchors'] as Record<string, unknown>).filter(
            ([name]) => name !== 'sample.sign-out-button' && !name.startsWith('sample.form.'),
          ),
        )

        screen['anchors'] = {
          ...anchors,
          'sample.form.title-input': { kind: 'input', binding: { model: 'thing.title' } },
          'sample.form.error': { kind: 'error' },
          ...buttons,
        }
        screen['flow'] = { initial: 'viewing', states: { viewing: { type: 'parallel', states } } }
      })
    const button = (action: string) => ({
      kind: 'button',
      binding: { action, params: { title: 'sample.form.title-input' } },
    })

    withRegions(
      {},
      {
        'sample.form.add-button': button('thing.createThing'),
        'sample.form.rename-button': button('thing.updateThing'),
      },
    )

    const viewing = loadScreens(root).screens?.screens[0]?.flow?.states['viewing']

    expect(problems()).toEqual([])
    expect(Object.keys(viewing !== undefined && 'states' in viewing ? viewing.states : {})).toEqual(
      ['form-add', 'form-rename'],
    )

    withRegions(
      { form: { by: 'sample.form.add-button' } },
      {
        'sample.form.add-button': button('thing.createThing'),
      },
    )

    expect(messages()).toEqual([
      'flow.states.viewing.states: a parallel state has two regions or more',
    ])
  })

  it('reports what keeps a flow from expanding, at its place in the file', () => {
    writeSample((screen) => {
      screen['flow'] = {
        initial: 'editing',
        states: { editing: { entry: [{ show: 'sample.nothing-button' }] } },
      }
    })

    expect(messages()).toEqual([
      'flow.states.editing.entry[0].show: no screen declares the anchor sample.nothing-button',
    ])
  })
})
