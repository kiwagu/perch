import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { fixtureContract } from '../manifest/manifest.fixture'

import { diffContracts } from './diff'
import { formatChanges } from './format-changes'

/** The fixture contract with one anchor renamed, one code added and one field removed. */
function changed(before: Contract): Contract {
  const after = structuredClone(before)
  const [screen] = after.screens.screens

  if (screen === undefined) {
    throw new Error('the fixture has no screen')
  }

  const { 'sample.save-button': saved, ...anchors } = screen.anchors

  if (saved === undefined) {
    throw new Error('the fixture has no sample.save-button')
  }

  screen.anchors = { ...anchors, 'sample.store-button': saved }
  after.vocabulary.codes['spare'] = { where: 'sample.error', meaning: 'a spare code' }

  const thing = after.model.entities['thing']

  if (thing === undefined) {
    throw new Error('the fixture has no thing entity')
  }

  const { title: _title, ...fields } = thing.fields

  thing.fields = fields

  return after
}

/** A visit to the sample screen, as each state of the fixture's activity is. */
const atSample = () => ({ screen: 'sample', address: { path: '/sample/$key' } })

/**
 * The fixture contract with a second activity, `gone` before the change and `invite` after
 * it; after it, `thing` also saves on the title input and leads back from `saved`.
 */
function withActivities(base: Contract, side: 'before' | 'after'): Contract {
  const contract = structuredClone(base)
  const [thing] = contract.activities

  if (thing === undefined) {
    throw new Error('the fixture has no activity')
  }

  contract.activities.push({ ...structuredClone(thing), id: side === 'before' ? 'gone' : 'invite' })

  if (side === 'after') {
    thing.states = {
      editing: {
        meta: atSample(),
        on: {
          'sample.title-input': [{ guard: 'titleGiven', target: 'saved' }, { target: 'saved' }],
        },
      },
      saved: { meta: atSample(), on: { 'sample.page': { target: 'editing' } } },
    }
  }

  return contract
}

const ACTIVITY_CHANGES = {
  added: ['invite'],
  removed: ['gone'],
  transitions: {
    thing: {
      added: ['editing on sample.title-input -> saved', 'saved on sample.page -> editing'],
      removed: ['editing on sample.save-button -> saved'],
    },
  },
}

describe('diffContracts', () => {
  const before = fixtureContract()
  const after = changed(before)

  it('pairs an anchor removed and one added with the same screen and kind as a rename', () => {
    expect(diffContracts(before, after)).toEqual({
      anchors: {
        added: [],
        removed: [],
        renamed: [{ from: 'sample.save-button', to: 'sample.store-button' }],
      },
      derived: { added: [], removed: [] },
      codes: { added: ['spare'], removed: [] },
      anchorCodes: { added: [], removed: [] },
      errorFields: { added: [], removed: [] },
      inputs: { added: [], removed: [] },
      questions: { added: [], removed: [] },
      leaving: { added: [], removed: [] },
      unsavedInput: { added: [], removed: [] },
      notices: { added: [], removed: [] },
      screens: { added: [], removed: [] },
      entities: { added: [], removed: [] },
      fields: { added: [], removed: ['thing.title'] },
      activities: {
        added: [],
        removed: [],
        transitions: { thing: { added: [], removed: [] } },
      },
    })
  })
  it('lists the codes and the error fields gained or lost by the anchors both contracts hold', () => {
    const more = structuredClone(after)
    const screen = more.screens.screens[0]

    if (screen === undefined) {
      throw new Error('the fixture has no screen')
    }

    screen.anchors['sample.store-button'] = {
      ...screen.anchors['sample.store-button'],
      kind: 'button',
      codes: ['saved', 'spare'],
    }
    screen.anchors['sample.title-error'] = { kind: 'error', codes: ['spare'] }
    screen.anchors['sample.page'] = {
      ...screen.anchors['sample.page'],
      kind: 'page',
      fields: { spare: 'sample.title-input' },
    }

    const changes = diffContracts(before, more)

    expect(changes.anchorCodes).toEqual({
      added: ['sample.store-button spare'],
      removed: ['sample.store-button failed'],
    })
    expect(changes.errorFields).toEqual({
      added: ['sample.page spare -> sample.title-input'],
      removed: [],
    })
    screen.anchors['sample.title-input'] = {
      ...screen.anchors['sample.title-input'],
      kind: 'input',
      holdsInput: false,
    }

    expect(diffContracts(before, more).inputs).toEqual({
      added: [],
      removed: ['sample.title-input holds input'],
    })
    expect(formatChanges(changes)).toContain('anchor codes added: sample.store-button spare')
  })
  it('lists the derived parts the anchors both contracts hold start or stop rendering', () => {
    const eye = structuredClone(after)

    Object.assign(eye.screens.screens[0]?.anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })

    expect(diffContracts(after, eye).derived).toEqual({
      added: ['sample.title-input.visibility-button'],
      removed: [],
    })
    expect(diffContracts(eye, after).derived).toEqual({
      added: [],
      removed: ['sample.title-input.visibility-button'],
    })
    expect(formatChanges(diffContracts(after, eye)).split('\n')).toEqual([
      'contract changes: 1 derived anchor added',
      'derived anchors added: sample.title-input.visibility-button',
    ])
  })
  it('lists a toast code a new model action derives as an anchor code added', () => {
    const withToast = (codes: readonly string[]): Contract => {
      const contract = structuredClone(before)
      const screen = contract.screens.screens[0]

      if (screen === undefined) {
        throw new Error('the fixture has no screen')
      }

      screen.anchors['sample.toast'] = {
        kind: 'toast',
        ...(codes.length > 0 ? { codes: [...codes] } : {}),
      }

      return contract
    }

    expect(diffContracts(withToast([]), withToast(['note-created'])).anchorCodes).toEqual({
      added: ['sample.toast note-created'],
      removed: [],
    })
  })
  it('lists the codes of the contract, the derived toast codes in and the rule row out', () => {
    const toasts = (codes: readonly string[]): Contract => {
      const contract = structuredClone(before)

      if (codes.length > 0) {
        contract.vocabulary.codes['<object>-<verb>ed'] = {
          where: 'app-shell.toast',
          meaning: 'the success of an action of the model',
        }
      }

      contract.screens.toasts = codes.map((code) => ({
        anchor: 'app-shell.toast',
        code,
        action: `note.${code}`,
      }))

      return contract
    }

    expect(diffContracts(toasts([]), toasts(['note-created', 'note-deleted'])).codes).toEqual({
      added: ['note-created', 'note-deleted'],
      removed: [],
    })
    expect(diffContracts(toasts(['note-created']), toasts([])).codes).toEqual({
      added: [],
      removed: ['note-created'],
    })
    expect(diffContracts(toasts(['note-created']), toasts(['note-updated'])).codes).toEqual({
      added: ['note-updated'],
      removed: ['note-created'],
    })
  })
  it('lists how each leave that would lose unsaved input asks, as it changes', () => {
    const asking = structuredClone(before)

    asking.screens.platform.unsavedInput = {
      question: 'sample.leave-dialog',
      screen: 'question',
      actions: 'question',
      unload: 'browser',
      state: 'never',
      flow: 'never',
      elsewhere: 'cannot',
    }

    const quieter = structuredClone(asking)

    if (quieter.screens.platform.unsavedInput !== undefined) {
      quieter.screens.platform.unsavedInput.unload = 'never'
    }

    expect(diffContracts(before, asking).unsavedInput.added).toEqual([
      'actions: question',
      'elsewhere: cannot',
      'flow: never',
      'question: sample.leave-dialog',
      'screen: question',
      'state: never',
      'unload: browser',
    ])
    expect(diffContracts(asking, quieter).unsavedInput).toEqual({
      added: ['unload: never'],
      removed: ['unload: browser'],
    })
    expect(formatChanges(diffContracts(asking, quieter))).toContain(
      'unsaved-input entries added: unload: never',
    )
  })
  it('lists the notices each platform action declares, as they come and go', () => {
    const noticing = (names: readonly string[]): Contract => {
      const contract = structuredClone(before)

      Object.assign(contract.screens.platform.actions['sign-out'] ?? {}, {
        notices: names.map((name) => ({ name, to: 'account', language: 'account' })),
      })

      return contract
    }

    expect(diffContracts(before, noticing(['signed-out'])).notices).toEqual({
      added: ['sign-out.signed-out'],
      removed: [],
    })
    expect(diffContracts(noticing(['signed-out']), noticing(['password-changed'])).notices).toEqual(
      { added: ['sign-out.password-changed'], removed: ['sign-out.signed-out'] },
    )
    expect(formatChanges(diffContracts(noticing(['signed-out']), before)).split('\n')).toEqual([
      'contract changes: 1 notice removed',
      'notices removed: sign-out.signed-out',
    ])
  })
  it('lists the activities added and removed, and the transitions changed in each on both sides', () => {
    expect(
      diffContracts(withActivities(before, 'before'), withActivities(before, 'after')).activities,
    ).toEqual(ACTIVITY_CHANGES)
  })
  it('leaves the anchors added and removed when the pairing is ambiguous', () => {
    const twice = structuredClone(after)
    const [screen] = twice.screens.screens
    const store = screen?.anchors['sample.store-button']

    if (screen === undefined || store === undefined) {
      throw new Error('the changed fixture lost its anchor')
    }

    screen.anchors['sample.keep-button'] = store

    expect(diffContracts(before, twice).anchors).toEqual({
      added: ['sample.keep-button', 'sample.store-button'],
      removed: ['sample.save-button'],
      renamed: [],
    })
  })
  it('takes a missing contract as an empty one', () => {
    const changes = diffContracts(undefined, before)

    expect(changes.screens.added).toEqual(['sample'])
    expect(changes.anchors.added).toEqual([
      'sample.list',
      'sample.list.row-item',
      'sample.page',
      'sample.save-button',
      'sample.sign-out-button',
      'sample.title-input',
    ])
    expect(changes.codes.added).toEqual(['failed', 'saved'])
    expect(changes.entities.added).toEqual(['thing'])
    expect(changes.fields.added).toEqual([
      'thing.author',
      'thing.created_at',
      'thing.id',
      'thing.size',
      'thing.title',
    ])
    expect(changes.anchors.removed).toEqual([])
    expect(changes.activities).toEqual({ added: ['thing'], removed: [], transitions: {} })
  })
  it('finds nothing between a contract and itself', () => {
    expect(formatChanges(diffContracts(before, before))).toBe('contract changes: none')
  })
})

describe('formatChanges', () => {
  it('prints a summary line, then one line per list that is not empty', () => {
    const before = fixtureContract()

    expect(formatChanges(diffContracts(before, changed(before))).split('\n')).toEqual([
      'contract changes: 1 anchor renamed, 1 code added, 1 field removed',
      'anchors renamed: sample.save-button -> sample.store-button',
      'codes added: spare',
      'fields removed: thing.title',
    ])
  })
  it('counts in the plural and keeps the order screens, anchors, codes, entities, fields, activities', () => {
    const changes = diffContracts(undefined, fixtureContract())

    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 screen added, 6 anchors added, 2 codes added, 1 entity added, 5 fields added, 1 activity added',
      'screens added: sample',
      'anchors added: sample.list, sample.list.row-item, sample.page, sample.save-button, sample.sign-out-button, sample.title-input',
      'codes added: failed, saved',
      'entities added: thing',
      'fields added: thing.author, thing.created_at, thing.id, thing.size, thing.title',
      'activities added: thing',
    ])
  })
  it('prints the activities added and removed, then the transitions changed in each', () => {
    const before = fixtureContract()
    const changes = diffContracts(withActivities(before, 'before'), withActivities(before, 'after'))

    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 activity added, 1 activity removed, 2 transitions added in thing, 1 transition removed in thing',
      'activities added: invite',
      'activities removed: gone',
      'transitions added in thing: editing on sample.title-input -> saved, saved on sample.page -> editing',
      'transitions removed in thing: editing on sample.save-button -> saved',
    ])
  })
})

describe('diffContracts and the questions before destructive actions', () => {
  /** The fixture contract, `sample.save-button` asking with `code` when one is given. */
  const asking = (code?: string): Contract => {
    const contract = fixtureContract()
    const anchor = contract.screens.screens[0]?.anchors['sample.save-button']

    if (code !== undefined && anchor !== undefined) {
      anchor.asks = { dialog: 'app-shell.confirmation', code }
      contract.vocabulary.codes['<object>-<verb>'] = {
        where: 'app-shell.confirmation',
        meaning: 'the question before a destructive action',
      }
      contract.screens.questions = [
        { anchor: 'app-shell.confirmation', code, action: 'thing.deleteThing' },
      ]
    }

    return contract
  }

  it('lists a control that starts or stops asking, and the question codes, the rule row out', () => {
    expect(diffContracts(asking(), asking('thing-delete')).questions).toEqual({
      added: ['sample.save-button asks thing-delete'],
      removed: [],
    })
    expect(diffContracts(asking('thing-delete'), asking()).questions).toEqual({
      added: [],
      removed: ['sample.save-button asks thing-delete'],
    })
    expect(diffContracts(asking(), asking('thing-delete')).codes).toEqual({
      added: ['thing-delete'],
      removed: [],
    })
  })
})
