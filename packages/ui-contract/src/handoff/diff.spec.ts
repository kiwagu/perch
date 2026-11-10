import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import type { Effect, Flow, FlowState, FlowTransition } from '../files'
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

/**
 * The fixture contract with the state of `sample.list` removed, a composite declared by the
 * platform and the `saving` state failing back to itself rather than to `editing`.
 */
function reshaped(before: Contract): Contract {
  const after = structuredClone(before)
  const [screen] = after.screens.screens
  const list = screen?.anchors['sample.list']
  const saving = screen?.flow?.states['saving']
  const onError = saving?.type === 'parallel' ? undefined : saving?.invoke?.onError

  if (
    screen === undefined ||
    list === undefined ||
    saving === undefined ||
    saving.type === 'parallel' ||
    saving.invoke === undefined ||
    onError === undefined ||
    Array.isArray(onError)
  ) {
    throw new Error('the fixture lost its list or its saving state')
  }

  const { states: _states, ...stateless } = list

  screen.anchors['sample.list'] = stateless
  saving.invoke.onError = { ...onError, target: 'saving' }
  after.screens.platform.composites = {
    'password-rules': {
      description: 'The rules a new password meets.',
      list: 'password-rule-list',
      itemState: 'met',
      items: { length: 'At least eight characters.' },
    },
  }

  return after
}

/** The plain state `name` of a flow, for a spec to change. */
function plainState(flow: Flow, name: string): FlowState {
  const state = flow.states[name]

  if (state === undefined || state.type === 'parallel') {
    throw new Error(`the flow has no plain state ${name}`)
  }

  return state
}

/** The fixture contract with the flow of its sample screen changed by `change`. */
function withFlow(base: Contract, change: (flow: Flow) => void): Contract {
  const contract = structuredClone(base)
  const flow = contract.screens.screens[0]?.flow

  if (flow === undefined) {
    throw new Error('the fixture has no flow')
  }

  change(flow)

  return contract
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
      composites: { added: [], removed: [] },
      codes: { added: ['spare'], removed: [] },
      anchorCodes: { added: [], removed: [] },
      anchorStates: { added: [], removed: [] },
      anchorRoles: { added: [], removed: [] },
      errorFields: { added: [], removed: [] },
      inputs: { added: [], removed: [] },
      questions: { added: [], removed: [] },
      ranks: { added: [], removed: [] },
      leaving: { added: [], removed: [] },
      unsavedInput: { added: [], removed: [] },
      notices: { added: [], removed: [] },
      screens: { added: [], removed: [] },
      routeAccess: { added: [], removed: [] },
      sources: { added: [], removed: [] },
      entities: { added: [], removed: [] },
      fields: { added: [], removed: ['thing.title'] },
      activities: {
        added: [],
        removed: [],
        transitions: { thing: { added: [], removed: [] } },
      },
      flows: { sample: { added: [], removed: [] } },
      actions: { added: [], removed: [] },
      actionLines: { 'sign-out': { added: [], removed: [] } },
      descriptions: [],
    })
  })
  it('lists the composites, the states of the anchors both hold and the lines of each flow', () => {
    const changes = diffContracts(before, reshaped(before))

    expect(changes.composites).toEqual({ added: ['password-rules'], removed: [] })
    expect(changes.anchorStates).toEqual({ added: [], removed: ['sample.list loading'] })
    expect(changes.flows).toEqual({
      sample: {
        added: ['saving onError -> saving show sample.save-button: failed'],
        removed: ['saving onError -> editing show sample.save-button: failed'],
      },
    })
    expect(diffContracts(reshaped(before), before).composites).toEqual({
      added: [],
      removed: ['password-rules'],
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
      'contract changes: 1 notice removed, 1 platform action line removed in sign-out',
      'notices removed: sign-out.signed-out',
      'platform action lines removed in sign-out: notice signed-out to account language account',
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
    expect(changes.routeAccess).toEqual({
      added: ['/sample/$key guard authenticated', '/sample/$key serves member'],
      removed: [],
    })
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
    expect(changes.flows).toEqual({})
    expect(changes.actions).toEqual({ added: ['sign-out'], removed: [] })
    expect(changes.actionLines).toEqual({
      'sign-out': {
        added: ['code failed', 'param forgetUnsent: boolean', 'result: this device signs out'],
        removed: [],
      },
    })
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
  it('counts in the plural and keeps the order screens, anchors, codes, platform actions, entities, fields, activities', () => {
    const changes = diffContracts(undefined, fixtureContract())

    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 screen added, 2 route access lines added, 6 anchors added, 2 codes added, 1 platform action added, 1 entity added, 5 fields added, 1 activity added, 3 platform action lines added in sign-out, 13 descriptions changed',
      'screens added: sample',
      'route access lines added: /sample/$key guard authenticated, /sample/$key serves member',
      'anchors added: sample.list, sample.list.row-item, sample.page, sample.save-button, sample.sign-out-button, sample.title-input',
      'codes added: failed, saved',
      'platform actions added: sign-out',
      'entities added: thing',
      'fields added: thing.author, thing.created_at, thing.id, thing.size, thing.title',
      'activities added: thing',
      'platform action lines added in sign-out: code failed, param forgetUnsent: boolean, result: this device signs out',
      'descriptions changed: activity thing new -> 62, activity thing data thing new -> 35, activity thing data thing.title new -> 27, activity thing state editing new -> 22, activity thing state editing on sample.save-button new -> 19, activity thing state saved new -> 31, model action thing.createThing new -> 13, model entity thing new -> 48, model field thing.id new -> 15, platform action sign-out new -> 22, platform action sign-out param forgetUnsent new -> 24, sample new -> 90, sample.page new -> 23',
    ])
  })
  it('prints the descriptions changed last, each by its place with its length before and after', () => {
    const before = fixtureContract()
    const after = {
      ...before,
      descriptions: before.descriptions.flatMap((written) => {
        switch (written.place) {
          case 'sample.page':
            return [{ ...written, text: `${written.text.slice(0, -1)}, with its form.` }]
          case 'model field thing.id':
            return []
          default:
            return [written]
        }
      }),
    }

    expect(formatChanges(diffContracts(before, after)).split('\n')).toEqual([
      'contract changes: 2 descriptions changed',
      'descriptions changed: model field thing.id 15 -> gone, sample.page 23 -> 38',
    ])
    expect(formatChanges(diffContracts(after, before)).split('\n')).toEqual([
      'contract changes: 2 descriptions changed',
      'descriptions changed: model field thing.id new -> 15, sample.page 38 -> 23',
    ])
    expect(diffContracts(before, after).descriptions).toEqual([
      { place: 'model field thing.id', before: 15 },
      { place: 'sample.page', before: 23, after: 38 },
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
  it('prints the composites, the anchor states and the flow lines changed in each screen', () => {
    const before = fixtureContract()

    expect(formatChanges(diffContracts(before, reshaped(before))).split('\n')).toEqual([
      'contract changes: 1 composite added, 1 anchor state removed, 1 flow line added in sample, 1 flow line removed in sample',
      'composites added: password-rules',
      'anchor states removed: sample.list loading',
      'flow lines added in sample: saving onError -> saving show sample.save-button: failed',
      'flow lines removed in sample: saving onError -> editing show sample.save-button: failed',
    ])
  })
})

describe('diffContracts and the order and the inputs of a flow', () => {
  const before = fixtureContract()
  const given: FlowTransition = { guard: 'titleGiven', target: 'saving' }
  const otherwise: FlowTransition = { target: 'editing' }
  const clearError: Effect = { type: 'clear', params: { anchor: 'sample.save-button' } }
  const showError: Effect = {
    type: 'show',
    params: { anchor: 'sample.save-button', codes: ['failed'] },
  }
  const flowsBetween = (from: (flow: Flow) => void, to: (flow: Flow) => void) =>
    diffContracts(withFlow(before, from), withFlow(before, to)).flows

  it('lists two guarded alternatives of an event swapped, as the first that holds is taken', () => {
    expect(
      flowsBetween(
        (flow) => {
          plainState(flow, 'editing').on = { 'sample.save-button': [given, otherwise] }
        },
        (flow) => {
          plainState(flow, 'editing').on = { 'sample.save-button': [otherwise, given] }
        },
      ),
    ).toEqual({
      sample: {
        added: [
          'editing on sample.save-button #1 -> editing',
          'editing on sample.save-button #2 -> saving [titleGiven]',
        ],
        removed: [
          'editing on sample.save-button #1 -> saving [titleGiven]',
          'editing on sample.save-button #2 -> editing',
        ],
      },
    })
  })
  it('lists the anchors a state renders as a set: one listed more is a line, another order none', () => {
    expect(
      flowsBetween(
        (flow) => {
          plainState(flow, 'saving').meta = { renders: ['sample.list', 'sample.save-button'] }
        },
        (flow) => {
          plainState(flow, 'saving').meta = {
            renders: ['sample.title-input', 'sample.save-button', 'sample.list'],
          }
        },
      ),
    ).toEqual({ sample: { added: ['saving renders sample.title-input'], removed: [] } })
  })
  it('lists a guard written by failure code, and the codes it takes as they change', () => {
    const guarded = (guard: string | { codes: string[] }) => (flow: Flow) => {
      flow.meta = { guards: { titleGiven: 'the title input holds a title', limited: guard } }
    }

    expect(
      flowsBetween(guarded('the network address tried too often'), guarded({ codes: ['failed'] })),
    ).toEqual({ sample: { added: ['guard limited takes failed'], removed: [] } })
    expect(
      flowsBetween(guarded({ codes: ['failed'] }), guarded({ codes: ['rate-limited', 'failed'] })),
    ).toEqual({
      sample: {
        added: ['guard limited takes rate-limited, failed'],
        removed: ['guard limited takes failed'],
      },
    })
    expect(
      flowsBetween(guarded('the network address tried too often'), guarded('it tried too often')),
    ).toEqual({ sample: { added: [], removed: [] } })
  })
  it('lists two entry effects swapped, as the last one decides what shows', () => {
    expect(
      flowsBetween(
        (flow) => {
          plainState(flow, 'saving').entry = [clearError, showError]
        },
        (flow) => {
          plainState(flow, 'saving').entry = [showError, clearError]
        },
      ),
    ).toEqual({
      sample: {
        added: [
          'saving entry #1 show sample.save-button: failed',
          'saving entry #2 clear sample.save-button',
        ],
        removed: [
          'saving entry #1 clear sample.save-button',
          'saving entry #2 show sample.save-button: failed',
        ],
      },
    })
  })
  it('lists a branch that starts saying nothing reads after its outcome, as a changed line', () => {
    const outcomes = (branch: FlowTransition) => (flow: Flow) => {
      const { invoke } = plainState(flow, 'saving')

      if (invoke !== undefined) {
        invoke.onDone = [branch, otherwise]
      }
    }

    expect(flowsBetween(outcomes(given), outcomes({ ...given, read: false }))).toEqual({
      sample: {
        added: ['saving onDone #1 -> saving [titleGiven] read: false'],
        removed: ['saving onDone #1 -> saving [titleGiven]'],
      },
    })
  })
  it('lists an invoke whose input takes a parameter from elsewhere', () => {
    expect(
      flowsBetween(
        () => undefined,
        (flow) => {
          const { invoke } = plainState(flow, 'saving')

          if (invoke !== undefined) {
            invoke.input = { title: { value: 'untitled' } }
          }
        },
      ),
    ).toEqual({
      sample: {
        added: ['saving invoke thing.updateThing {"title":{"value":"untitled"}}'],
        removed: ['saving invoke thing.updateThing {"title":"sample.title-input"}'],
      },
    })
  })
})

describe('diffContracts and a whole flow, and the addresses of its states', () => {
  const before = fixtureContract()
  const LINES = [
    'editing on sample.save-button -> saving',
    'initial editing',
    'saving invoke thing.updateThing {"title":"sample.title-input"}',
    'saving onDone -> editing show sample.save-button: saved navigate /sample/$key',
    'saving onError -> editing show sample.save-button: failed',
  ]
  /** The fixture contract with no flow on its sample screen. */
  const flowless = (): Contract => {
    const contract = structuredClone(before)
    const [screen] = contract.screens.screens

    if (screen === undefined) {
      throw new Error('the fixture has no screen')
    }

    delete screen.flow

    return contract
  }

  it('lists every line of a flow removed from a screen both contracts hold', () => {
    expect(diffContracts(before, flowless()).flows).toEqual({
      sample: { added: [], removed: LINES },
    })
  })
  it('lists every line of a flow added to a screen both contracts hold', () => {
    const changes = diffContracts(flowless(), before)

    expect(changes.flows).toEqual({ sample: { added: LINES, removed: [] } })
    expect(formatChanges(changes)).not.toBe('contract changes: none')
  })
  it('reports a screen added or removed whole under screens only', () => {
    expect(diffContracts(undefined, before).flows).toEqual({})
    expect(diffContracts(before, undefined).flows).toEqual({})
  })
  it("lists a state's address whose path or search value changes", () => {
    const addressed = (path: string, search?: Record<string, string>) =>
      withFlow(before, (flow) => {
        plainState(flow, 'editing').meta = {
          address: { path, ...(search === undefined ? {} : { search }) },
        }
      })

    expect(diffContracts(addressed('/sample/$key'), addressed('/sample/$key/edit')).flows).toEqual({
      sample: {
        added: ['editing address /sample/$key/edit'],
        removed: ['editing address /sample/$key'],
      },
    })
    expect(
      diffContracts(
        addressed('/sample/$key', { tab: 'a' }),
        addressed('/sample/$key', { tab: 'b' }),
      ).flows,
    ).toEqual({
      sample: {
        added: ['editing address /sample/$key {"tab":"b"}'],
        removed: ['editing address /sample/$key {"tab":"a"}'],
      },
    })
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

describe('diffContracts and the ranked messages', () => {
  /** The fixture contract with `sample.status-message`, its codes ranked in `order` when given. */
  const ranking = (order?: readonly string[]): Contract => {
    const contract = fixtureContract()
    const [screen] = contract.screens.screens

    if (screen === undefined) {
      throw new Error('the fixture has no screen')
    }

    screen.anchors['sample.status-message'] =
      order === undefined
        ? { kind: 'message', codes: ['saved', 'failed'] }
        : { kind: 'message', codes: [...order], ranked: true }

    return contract
  }

  it('lists a message that starts or stops ranking its codes, with its order', () => {
    expect(diffContracts(ranking(), ranking(['saved', 'failed'])).ranks).toEqual({
      added: ['sample.status-message ranks saved > failed'],
      removed: [],
    })
    expect(diffContracts(ranking(['saved', 'failed']), ranking()).ranks).toEqual({
      added: [],
      removed: ['sample.status-message ranks saved > failed'],
    })
  })
  it('lists a new order of a ranked message, which its codes alone do not show', () => {
    const changes = diffContracts(ranking(['saved', 'failed']), ranking(['failed', 'saved']))

    expect(changes.ranks).toEqual({
      added: ['sample.status-message ranks failed > saved'],
      removed: ['sample.status-message ranks saved > failed'],
    })
    expect(changes.anchorCodes).toEqual({ added: [], removed: [] })
    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 ranked message added, 1 ranked message removed',
      'ranked messages added: sample.status-message ranks failed > saved',
      'ranked messages removed: sample.status-message ranks saved > failed',
    ])
  })
  it('shows nothing for a new order of codes that are not ranked', () => {
    const before = ranking()
    const after = ranking()
    const anchor = after.screens.screens[0]?.anchors['sample.status-message']

    if (anchor === undefined) {
      throw new Error('the fixture has no sample.status-message')
    }

    anchor.codes = ['failed', 'saved']

    expect(formatChanges(diffContracts(before, after))).toBe('contract changes: none')
  })
})

describe('diffContracts and the sources of the lists', () => {
  /** The fixture contract with a list of accounts read as `source` says. */
  const reading = (source?: Record<string, unknown>): Contract => {
    const contract = fixtureContract()
    const [screen] = contract.screens.screens

    if (screen === undefined) {
      throw new Error('the fixture has no screen')
    }

    if (source !== undefined) {
      screen.anchors['sample.accounts-list'] = {
        kind: 'list',
        source: { platform: 'accounts.list', ...source },
      }
    }

    return contract
  }

  it('lists a source that comes to page or reads another search, as its line removed and added', () => {
    const changes = diffContracts(
      reading({ params: { q: { search: 'q' } } }),
      reading({ params: { q: { search: 'term' } }, paged: true }),
    )

    expect(changes.sources).toEqual({
      added: ['sample.accounts-list reads platform.accounts.list q=search:term paged'],
      removed: ['sample.accounts-list reads platform.accounts.list q=search:q'],
    })
    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 list source added, 1 list source removed',
      'list sources added: sample.accounts-list reads platform.accounts.list q=search:term paged',
      'list sources removed: sample.accounts-list reads platform.accounts.list q=search:q',
    ])
  })
  it('lists the source of a list added whole, which nothing else in the summary says', () => {
    expect(diffContracts(reading(), reading({ paged: true })).sources).toEqual({
      added: ['sample.accounts-list reads platform.accounts.list paged'],
      removed: [],
    })
  })
})

describe('diffContracts and who a route serves', () => {
  /** The fixture contract with its route's guard, the roles it serves and the save button's. */
  const serving = (
    guard: 'authenticated' | undefined,
    roles: readonly string[],
    button: readonly string[] | undefined,
  ): Contract => {
    const contract = fixtureContract()
    const [screen] = contract.screens.screens
    const [binding] = screen?.bindings ?? []
    const saveButton = screen?.anchors['sample.save-button']

    if (binding === undefined || saveButton === undefined) {
      throw new Error('the fixture has no binding or no sample.save-button')
    }

    if (guard === undefined) {
      delete binding.guard
    } else {
      binding.guard = guard
    }

    binding.roles = [...roles]

    if (button === undefined) {
      delete saveButton.roles
    } else {
      saveButton.roles = [...button]
    }

    return contract
  }

  it("lists a route's guard and each role it serves, and each role an anchor is shown to", () => {
    const changes = diffContracts(
      serving('authenticated', ['member'], ['member']),
      serving(undefined, ['operator'], undefined),
    )

    expect(changes.routeAccess).toEqual({
      added: ['/sample/$key serves operator'],
      removed: ['/sample/$key guard authenticated', '/sample/$key serves member'],
    })
    expect(changes.anchorRoles).toEqual({ added: [], removed: ['sample.save-button member'] })
    expect(formatChanges(changes).split('\n')).toEqual([
      'contract changes: 1 route access line added, 2 route access lines removed, 1 anchor role removed',
      'route access lines added: /sample/$key serves operator',
      'route access lines removed: /sample/$key guard authenticated, /sample/$key serves member',
      'anchor roles removed: sample.save-button member',
    ])
  })
  it('lists an anchor that comes to be shown to another role', () => {
    const changes = diffContracts(
      serving('authenticated', ['member', 'admin'], ['member']),
      serving('authenticated', ['member', 'admin'], ['admin']),
    )

    expect(changes.routeAccess).toEqual({ added: [], removed: [] })
    expect(changes.anchorRoles).toEqual({
      added: ['sample.save-button admin'],
      removed: ['sample.save-button member'],
    })
  })
})

describe('diffContracts and the platform actions', () => {
  const before = fixtureContract()

  /** The platform action `name` of `contract`, for a spec to change. */
  const actionOf = (contract: Contract, name: string) => {
    const action = contract.screens.platform.actions[name]

    if (action === undefined) {
      throw new Error(`the contract has no platform action ${name}`)
    }

    return action
  }

  /**
   * The fixture contract with `resend` added, an action that sends a mail, and the result and
   * the description of `sign-out` rewritten.
   */
  const mailing = (): Contract => {
    const contract = structuredClone(before)
    const signOut = actionOf(contract, 'sign-out')

    signOut.description = 'Signs this device out, at once.'
    signOut.result = 'this device signs out and its data goes'
    contract.screens.platform.actions['resend'] = {
      description: 'Sends the mail again.',
      params: { email: { type: 'string', description: 'The email of the account.' } },
      result: 'the mail is on its way',
      codes: ['failed'],
      mail: { to: 'email', language: 'account', link: { screen: 'sample', search: 'token' } },
    }

    return contract
  }
  const RESEND_LINES = [
    'code failed',
    'mail to email language account link sample?token',
    'param email: string',
    'result: the mail is on its way',
  ]

  it('lists the actions added and removed, each with every line it declares', () => {
    const added = diffContracts(before, mailing())
    const removed = diffContracts(mailing(), before)

    expect(added.actions).toEqual({ added: ['resend'], removed: [] })
    expect(added.actionLines['resend']).toEqual({ added: RESEND_LINES, removed: [] })
    expect(removed.actions).toEqual({ added: [], removed: ['resend'] })
    expect(removed.actionLines['resend']).toEqual({ added: [], removed: RESEND_LINES })
  })
  it('lists the result of an action both hold as it changes, its description aside', () => {
    expect(diffContracts(before, mailing()).actionLines['sign-out']).toEqual({
      added: ['result: this device signs out and its data goes'],
      removed: ['result: this device signs out'],
    })
  })
  it('lists a parameter, a code and a role an action gains or loses', () => {
    const changed = structuredClone(before)
    const signOut = actionOf(changed, 'sign-out')

    signOut.params = { everywhere: { type: 'boolean', description: 'Every device of it.' } }
    signOut.codes = ['failed', 'rate-limited']
    signOut.roles = ['admin']

    expect(diffContracts(before, changed).actionLines['sign-out']).toEqual({
      added: ['code rate-limited', 'param everywhere: boolean', 'role admin'],
      removed: ['param forgetUnsent: boolean'],
    })
  })
  it('lists a mail whose recipient, language or link changes, and a notice an action gains', () => {
    const noticing = mailing()
    const resend = actionOf(noticing, 'resend')

    resend.mail = { to: 'email', language: 'email', link: { screen: 'sample', search: 'code' } }
    actionOf(noticing, 'sign-out').notices = [
      { name: 'signed-out', to: 'account', language: 'account', link: { screen: 'sample' } },
    ]

    expect(diffContracts(mailing(), noticing).actionLines).toEqual({
      resend: {
        added: ['mail to email language email link sample?code'],
        removed: ['mail to email language account link sample?token'],
      },
      'sign-out': {
        added: ['notice signed-out to account language account link sample'],
        removed: [],
      },
    })
  })
  it('prints the actions added and removed, then the lines changed in each action', () => {
    expect(formatChanges(diffContracts(before, mailing())).split('\n')).toEqual([
      'contract changes: 1 platform action added, 4 platform action lines added in resend, 1 platform action line added in sign-out, 1 platform action line removed in sign-out',
      'platform actions added: resend',
      `platform action lines added in resend: ${RESEND_LINES.join(', ')}`,
      'platform action lines added in sign-out: result: this device signs out and its data goes',
      'platform action lines removed in sign-out: result: this device signs out',
    ])
  })
})
