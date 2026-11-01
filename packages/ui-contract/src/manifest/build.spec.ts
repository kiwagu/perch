import { describe, expect, it } from 'vitest'

import { VISIBILITY_VALUES } from '../anchors'
import { manifestSchema } from '../schemas'

import { buildManifest } from './build'
import { contractAt, fixtureContract, REPOSITORY_ROOT } from './manifest.fixture'

const PRODUCT = { name: 'perch', version: '0.0.0', commit: null }
const NOW = new Date('2026-10-21T12:00:00.000Z')

describe('buildManifest', () => {
  const contract = fixtureContract()
  const manifest = buildManifest({ ...contract, product: PRODUCT, now: NOW })

  it('names its format, the time it was built and the product', () => {
    expect(manifest.$schema).toBe('./manifest.schema.json')
    expect(manifest.manifestVersion).toBe(1)
    expect(manifest.generatedAt).toBe('2026-10-21T12:00:00.000Z')
    expect(manifest.product).toEqual(PRODUCT)
  })
  it('publishes the vocabulary as tables', () => {
    const { vocabulary } = contract

    expect(manifest.contract.version).toBe(1)
    expect(manifest.contract.idAttribute).toBe('data-testid')
    expect(manifest.contract.kinds).toEqual(vocabulary.kinds)
    expect(manifest.contract.derivedSuffixes).toEqual(vocabulary.suffixes)
    expect(manifest.contract.attributes['data-state']).toBe('a `status`: an app state')
    expect(manifest.contract.codes['saved']).toBe('`sample.notice-message`: the thing was saved')
    expect(manifest.contract.rowStates['current']).toBe('`sample.list.row-item`: this device')
    expect(manifest.contract.choiceValues).toEqual(vocabulary.choiceValues)
    expect(manifest.contract.reserved).toEqual(['sample.status'])
    expect(manifest.contract.appStateAnchor).toBe('sample.status')
    expect(manifest.contract.readyValue).toBe('ready')
    expect(manifest.contract.pageHelper).toBe('__perch.ui')
  })
  it('lists each derived toast code with its action, and leaves the rule row out', () => {
    const base = fixtureContract()
    const derived = buildManifest({
      ...base,
      vocabulary: {
        ...base.vocabulary,
        codes: {
          ...base.vocabulary.codes,
          '<object>-<verb>ed': {
            where: 'app-shell.toast',
            meaning: 'the success of an action of the model',
          },
        },
      },
      screens: {
        ...base.screens,
        toasts: [{ anchor: 'app-shell.toast', code: 'note-created', action: 'note.createNote' }],
      },
      product: PRODUCT,
      now: NOW,
    })

    expect(derived.contract.codes['note-created']).toBe(
      '`app-shell.toast`: the success of `note.createNote`',
    )
    expect(derived.contract.codes).not.toHaveProperty('<object>-<verb>ed')
    expect(manifestSchema.safeParse(derived).success).toBe(true)
  })
  it('lists every declared anchor once, with its kind, its screen and its attributes', () => {
    const declared = contract.screens.screens.flatMap((screen) => Object.keys(screen.anchors))

    expect(Object.keys(manifest.ids).sort()).toEqual([...declared].sort())
    expect(manifest.ids['sample.title-input']).toEqual({
      kind: 'input',
      screen: 'sample',
      binding: { model: 'thing.title' },
      holdsInput: true,
    })
    expect(manifest.ids['sample.save-button']).toMatchObject({
      kind: 'button',
      screen: 'sample',
      roles: ['member'],
      codes: ['saved', 'failed'],
    })
    expect(manifest.ids['sample.list.row-item']).toEqual({
      kind: 'item',
      screen: 'sample',
      dataId: "the thing's id",
    })
  })
  it("carries an error's fields, the field each of its codes concerns", () => {
    const withFields = fixtureContract()
    const screen = withFields.screens.screens.find(({ id }) => id === 'sample')

    if (screen === undefined) {
      expect.unreachable('the fixture has a sample screen')
    }

    screen.anchors['sample.save-error'] = {
      kind: 'error',
      codes: ['failed'],
      fields: { failed: 'sample.title-input' },
    }

    const built = buildManifest({ ...withFields, product: PRODUCT, now: NOW })

    expect(built.ids['sample.save-error']).toEqual({
      kind: 'error',
      screen: 'sample',
      codes: ['failed'],
      fields: { failed: 'sample.title-input' },
    })
    expect(manifestSchema.safeParse(built).success).toBe(true)
  })
  it('carries the screens, the platform, the activities, the scenarios and the model verbatim', () => {
    const withoutBindings = (screens: readonly { bindings: unknown }[]) =>
      screens.map(({ bindings: _bindings, ...screen }) => screen)

    expect(withoutBindings(manifest.screens)).toEqual(withoutBindings(contract.screens.screens))
    expect(manifest.activities.map((activity) => activity.id)).toEqual(['thing'])
    expect(manifest.activities).toEqual(contract.activities)
    expect(manifest.platform).toEqual(contract.screens.platform)
    expect(manifest.scenarios).toEqual(contract.scenarios)
    expect(manifest.model).toEqual(contract.model.document)
    expect(manifest.routeParams).toEqual({
      '/sample/$key': contract.screens.screens[0]?.bindings[0]?.params,
    })
  })
  it('gives each binding of a screen its example link', () => {
    const [binding] = contract.screens.screens[0]?.bindings ?? []

    expect(manifest.screens[0]?.bindings).toEqual([{ ...binding, example: '/sample/thg_01hzx9k2' }])
  })
  it('takes the readiness anchor of its instructions from the platform section', () => {
    expect(manifest.contract.instructions.readiness).toContain('sample.status')
  })
  it('builds a valid manifest from the contract of the repository', () => {
    const repository = contractAt(REPOSITORY_ROOT)
    const real = buildManifest({ ...repository, product: PRODUCT, now: NOW })
    const declared = repository.screens.screens.flatMap((screen) => Object.keys(screen.anchors))

    expect(real.scenarios.map((scenario) => scenario.id)).toEqual(
      repository.scenarios.map((scenario) => scenario.id),
    )

    expect(real.contract.instructions.readiness).toContain(
      '[data-testid="app-shell.status"][data-state="ready"]',
    )
    expect(Object.keys(real.ids).sort()).toEqual([...declared].sort())
    expect(manifestSchema.safeParse(real).error?.issues).toBeUndefined()
  })
})

describe('the questions before destructive actions', () => {
  it('lists each derived question code with its action, the rule row out, and the question on its control', () => {
    const base = fixtureContract()
    const [sample] = base.screens.screens
    const asks = { dialog: 'app-shell.confirmation', code: 'note-delete' }

    if (sample?.anchors['sample.save-button'] !== undefined) {
      sample.anchors['sample.save-button'].asks = asks
    }

    const derived = buildManifest({
      ...base,
      vocabulary: {
        ...base.vocabulary,
        codes: {
          ...base.vocabulary.codes,
          '<object>-<verb>': {
            where: 'app-shell.confirmation',
            meaning: 'the question before a destructive action',
          },
        },
      },
      screens: {
        ...base.screens,
        questions: [
          { anchor: 'app-shell.confirmation', code: 'note-delete', action: 'note.deleteNote' },
        ],
      },
      product: PRODUCT,
      now: NOW,
    })

    expect(derived.contract.codes['note-delete']).toBe(
      '`app-shell.confirmation`: the question before `note.deleteNote`',
    )
    expect(derived.contract.codes).not.toHaveProperty('<object>-<verb>')
    expect(derived.ids['sample.save-button']?.asks).toEqual(asks)
    expect(manifestSchema.safeParse(derived).success).toBe(true)
  })
})

describe('the visibility-button of a password input', () => {
  it('lists each derived part with its kind, the visibility-button with its values too', () => {
    const base = fixtureContract()

    Object.assign(base.screens.screens[0]?.anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })

    const built = buildManifest({
      ...base,
      vocabulary: {
        ...base.vocabulary,
        suffixes: {
          ...base.vocabulary.suffixes,
          'visibility-button': 'the eye of a password input',
        },
      },
      product: PRODUCT,
      now: NOW,
    })

    expect(built.ids['sample.title-input']?.derived).toEqual(['visibility-button'])
    expect(built.contract.derivedSuffixes['visibility-button']).toBe('the eye of a password input')
    expect(built.contract.derivedParts).toEqual({
      'confirm-button': { kind: 'button' },
      option: { kind: 'option' },
      'visibility-button': { kind: 'button', values: VISIBILITY_VALUES },
    })
    expect(Object.keys(VISIBILITY_VALUES)).toEqual(['show', 'hide'])
    expect(manifestSchema.safeParse(built).error?.issues).toBeUndefined()
  })
})

describe('the notices of a platform action', () => {
  it('carries each notice an action declares, and tells an agent how to read one', () => {
    const base = fixtureContract()
    const notices = [
      { name: 'password-changed', to: 'account', language: 'account', link: { screen: 'sample' } },
    ]

    Object.assign(base.screens.platform.actions['sign-out'] ?? {}, { notices })

    const built = buildManifest({ ...base, product: PRODUCT, now: NOW })

    expect(built.manifestVersion).toBe(1)
    expect(built.platform.actions['sign-out']?.notices).toEqual(notices)
    expect(built.contract.instructions.bindings).toContain('`notices`')
    expect(built.contract.instructions.scenarios).toContain('[notice:<action>.<name>]')
    expect(manifestSchema.safeParse(built).error?.issues).toBeUndefined()
  })
})
