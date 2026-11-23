import { describe, expect, it } from 'vitest'

import { formatProblem } from '../../files'
import { parallelIn, regionStateIn, withAreas } from '../areas.fixture'
import { afterSave, flowIn, flowStateIn, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract = sampleContract()): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'

const show = (anchor: string, codes: string[]) =>
  ({ type: 'show', params: { anchor, codes } }) as const

const clear = (anchor: string) => ({ type: 'clear', params: { anchor } }) as const

const read = (anchor: string) => ({ type: 'read', params: { anchor } }) as const

describe('flowProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('wants the initial state and every target to be a state of the flow', () => {
    const contract = sampleContract()

    flowIn(contract).initial = 'opening'
    flowStateIn(contract, 'editing').on = {
      'sample.save-button': [{ guard: 'titleGiven', target: 'saving' }, { target: 'constructor' }],
    }
    Object.assign(flowStateIn(contract, 'saving').invoke ?? {}, { onError: { target: 'failed' } })

    expect(printed(contract)).toEqual([
      `${AT}.initial: "opening" is not a state of the flow`,
      `${AT}.states.editing.on["sample.save-button"][1].target: "constructor" is not a state of the flow`,
      `${AT}.states.saving.invoke.onError.target: "failed" is not a state of the flow`,
      `${AT}.states.editing: is not reachable from "opening"`,
      `${AT}.states.saving: is not reachable from "opening"`,
    ])
  })
  it('wants every event to be a declared anchor or a platform event of platform.events', () => {
    const contract = sampleContract()

    contract.screens.platform.events = { opened: 'the local data is open' }
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.gone-button': { target: 'saving' },
      'sample.save-button.confirm-button': { target: 'saving' },
      'sample.mode-select.option': { target: 'saving' },
      'platform.opened': { target: 'saving' },
      'platform.closed': { target: 'saving' },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.gone-button"]: "sample.gone-button" is not a declared anchor`,
      `${AT}.states.editing.on["sample.save-button.confirm-button"]: "sample.save-button.confirm-button" is not a declared anchor`,
      `${AT}.states.editing.on["platform.closed"]: "platform.closed" is not an event of platform.events`,
    ])
  })
  it('refuses a visibility-button as an event: it is presentation only', () => {
    const contract = sampleContract()
    const title = screenIn(contract, 'sample').anchors['sample.title-input']

    Object.assign(title ?? {}, { derived: ['visibility-button'] })
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.title-input.visibility-button': { target: 'saving' },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.title-input.visibility-button"]: "sample.title-input.visibility-button" is a visibility-button: presentation only, never an event of a flow`,
    ])
  })
  it('takes a data event for a field of the model the screen shows, and no other', () => {
    const contract = sampleContract()

    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'model.thing.title': { target: 'saving' },
      'model.thing.created_at': { target: 'saving' },
      'model.thing.colour': { target: 'saving' },
      'model.gadget.title': { target: 'saving' },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["model.thing.created_at"]: "model.thing.created_at": no anchor of the screen shows thing.created_at`,
      `${AT}.states.editing.on["model.thing.colour"]: entity "thing" has no field "colour"`,
      `${AT}.states.editing.on["model.gadget.title"]: no entity "gadget" in the model`,
    ])
  })
  it('wants an invoke to run an action whose parameters its input names, from declared anchors', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    invoke.input = { title: 'sample.gone-input', size: { value: 3 } }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.input.title: "sample.gone-input" is not a declared anchor`,
      `${AT}.states.saving.invoke.input.size: "size" is not a parameter of "thing.updateThing"`,
    ])

    for (const src of ['thing.renameThing', 'gadget.createGadget', 'platform.sign-in']) {
      invoke.src = src
      invoke.input = {}

      expect(printed(contract)).toEqual([
        `${AT}.states.saving.invoke.src: ${
          {
            'thing.renameThing': 'entity "thing" has no action "renameThing"',
            'gadget.createGadget': 'no entity "gadget" in the model',
            'platform.sign-in': 'no platform action "sign-in"',
          }[src]
        }`,
      ])
    }
  })
  it("refuses a visibility-button as an invoke input's anchor, and keeps its input", () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    Object.assign(screenIn(contract, 'sample').anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })
    invoke.input = { title: 'sample.title-input.visibility-button' }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.input.title: "sample.title-input.visibility-button" is a visibility-button: presentation only, never a value an action takes`,
    ])

    invoke.input = { title: 'sample.title-input' }

    expect(printed(contract)).toEqual([])
  })
  it('takes an invoke input from a search parameter of every route of the screen', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    invoke.input = { title: { search: 'tab' } }

    expect(printed(contract)).toEqual([])

    invoke.input = { title: { search: 'token' } }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.input.title: "token" is not a search parameter of every route of the screen`,
    ])
  })
  it('takes an invoke input only from a search parameter on every route of the screen', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    screenIn(contract, 'sample').bindings.push({
      path: '/sample',
      roles: ['member'],
      history: 'push',
    })
    invoke.input = { title: { search: 'tab' } }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.input.title: "tab" is not a search parameter of every route of the screen`,
    ])
  })
  it('leaves out the minted id and any parameter the implementation computes', () => {
    const contract = sampleContract()

    Object.assign(flowStateIn(contract, 'saving').invoke ?? {}, { input: undefined })

    expect(printed(contract)).toEqual([])
  })
  it('holds a show to the codes of its anchor and a navigate to a binding and its search', () => {
    const contract = sampleContract()
    const editing = flowStateIn(contract, 'editing')

    editing.entry = [show('sample.gone-message', ['saved']), show('sample.save-button', ['gone'])]
    afterSave(contract, [
      { type: 'navigate', params: { to: '/nowhere' } },
      { type: 'navigate', params: { to: '/sample/$key', search: { page: 2, tab: 'b' } } },
    ])

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0].params.anchor: "sample.gone-message" is not a declared anchor`,
      `${AT}.states.editing.entry[1].params.codes[0]: "sample.save-button" carries no code "gone"`,
      `${AT}.states.saving.invoke.onDone[0].actions[0].params.to: "/nowhere" is the path of no binding`,
      `${AT}.states.saving.invoke.onDone[1].actions[0].params.search.page: "page" is not a search parameter of "/sample/$key"`,
    ])
  })
  it('carries into a search what a field of the screen holds', () => {
    const contract = sampleContract()

    afterSave(contract, [
      {
        type: 'navigate',
        params: { to: '/sample/$key', search: { tab: { anchor: 'sample.title-input' } } },
      },
      {
        type: 'navigate',
        params: { to: '/sample/$key', search: { tab: { anchor: 'sample.mode-select' } } },
      },
    ])

    expect(printed(contract)).toEqual([])
  })
  it('carries into a search only what a field of its own screen holds, under a key of the binding', () => {
    const contract = sampleContract()
    const navigate = (search: Record<string, { anchor: string }>) =>
      ({ type: 'navigate', params: { to: '/sample/$key', search } }) as const

    Object.assign(screenIn(contract, 'sample').anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })
    afterSave(contract, [
      navigate({ tab: { anchor: 'sample.gone-input' } }),
      navigate({ tab: { anchor: 'sample.save-button' } }),
      navigate({ tab: { anchor: 'sample.list' } }),
      navigate({ tab: { anchor: 'sample.title-input.visibility-button' } }),
      navigate({ tab: { anchor: 'app-shell.status' } }),
      navigate({ page: { anchor: 'sample.title-input' } }),
    ])

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.onDone[0].actions[0].params.search.tab.anchor: "sample.gone-input" is not a declared anchor of the screen`,
      `${AT}.states.saving.invoke.onDone[1].actions[0].params.search.tab.anchor: "sample.save-button" is a button, not a field: a search takes the value a field holds`,
      `${AT}.states.saving.invoke.onDone[2].actions[0].params.search.tab.anchor: "sample.list" is a list, not a field: a search takes the value a field holds`,
      `${AT}.states.saving.invoke.onDone[3].actions[0].params.search.tab.anchor: "sample.title-input.visibility-button" is a visibility-button: presentation only, never a value a search carries`,
      `${AT}.states.saving.invoke.onDone[4].actions[0].params.search.tab.anchor: "app-shell.status" is not a declared anchor of the screen`,
      `${AT}.states.saving.invoke.onDone[5].actions[0].params.search.page: "page" is not a search parameter of "/sample/$key"`,
    ])
  })
  it('carries an email typed into a search, never a secret field', () => {
    const contract = sampleContract()
    const navigate = (anchor: string) =>
      ({ type: 'navigate', params: { to: '/sample/$key', search: { tab: { anchor } } } }) as const

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.email-input': { kind: 'input' },
      'sample.password-input': { kind: 'input', secret: true, derived: ['visibility-button'] },
      'sample.password-confirmation-input': { kind: 'input', secret: true },
    })
    afterSave(contract, [
      navigate('sample.email-input'),
      navigate('sample.password-input'),
      navigate('sample.password-confirmation-input'),
    ])

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.onDone[1].actions[0].params.search.tab.anchor: "sample.password-input" is a secret field: never a value a search carries`,
      `${AT}.states.saving.invoke.onDone[2].actions[0].params.search.tab.anchor: "sample.password-confirmation-input" is a secret field: never a value a search carries`,
    ])
  })
  it('takes a clear of an anchor that carries codes, or of a field, a secret one included', () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.form.error': { kind: 'error', codes: ['failed'] },
      'sample.notice-message': { kind: 'message', codes: ['saved'] },
      'sample.password-input': { kind: 'input', secret: true, derived: ['visibility-button'] },
    })
    flowStateIn(contract, 'editing').entry = [
      clear('sample.form.error'),
      clear('sample.notice-message'),
      clear('sample.save-button'),
      clear('sample.title-input'),
      clear('sample.password-input'),
    ]

    expect(printed(contract)).toEqual([])
  })
  it('refuses a clear of an anchor that is no field and carries no code, and says what it may name', () => {
    const contract = sampleContract()
    const may =
      'a clear names a field, which it empties, or an anchor that carries codes, which then shows none'

    Object.assign(screenIn(contract, 'sample').anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })
    flowStateIn(contract, 'editing').entry = [
      clear('sample.gone-message'),
      clear('sample.page'),
      clear('sample.a-button'),
      clear('sample.list'),
      clear('sample.home-link'),
      clear('sample.title-input.visibility-button'),
    ]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0].params.anchor: "sample.gone-message" is not a declared anchor`,
      `${AT}.states.editing.entry[1].params.anchor: "sample.page" is no field and carries no code: ${may}`,
      `${AT}.states.editing.entry[2].params.anchor: "sample.a-button" is no field and carries no code: ${may}`,
      `${AT}.states.editing.entry[3].params.anchor: "sample.list" is no field and carries no code: ${may}`,
      `${AT}.states.editing.entry[4].params.anchor: "sample.home-link" is no field and carries no code: ${may}`,
      `${AT}.states.editing.entry[5].params.anchor: "sample.title-input.visibility-button" is a visibility-button, presentation only: ${may}`,
    ])
  })
  it("refuses a clear of another screen's field that carries no code: a flow empties a field of its own screen", () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.search-input': { kind: 'input' },
    })
    flowStateIn(contract, 'editing').exit = [clear('app-shell.search-input')]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.exit[0].params.anchor: "app-shell.search-input" is a field of another screen that carries no code: a clear empties a field of the flow's own screen`,
    ])
  })
  it('keeps the code meaning first: a field that carries codes, on any screen, shows none', () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.code-input': { kind: 'input', codes: ['failed'] },
    })
    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.code-input': { kind: 'input', codes: ['failed'] },
    })
    flowStateIn(contract, 'editing').exit = [
      clear('sample.code-input'),
      clear('app-shell.code-input'),
    ]

    expect(printed(contract)).toEqual([])
  })
  it('takes a read of a list of its own screen whose source is a platform action', () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.devices-table': { kind: 'table', source: { platform: 'devices.list' } },
    })
    flowStateIn(contract, 'editing').entry = [read('sample.devices-list')]
    Object.assign(flowStateIn(contract, 'saving').invoke ?? {}, {
      onDone: { target: 'editing', actions: [read('sample.devices-table')] },
    })

    expect(printed(contract)).toEqual([])
  })
  it('refuses a read of what has no platform source, or is not its own, and says what it may name', () => {
    const contract = sampleContract()
    const may =
      'a read names a list of its own screen whose source is a platform action, which it reads again'

    Object.assign(screenIn(contract, 'sample').anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })
    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.devices-list': { kind: 'list', source: { platform: 'devices.list' } },
    })
    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.devices-button': { kind: 'button', source: { platform: 'devices.list' } },
      'sample.plain-list': { kind: 'list' },
    })
    flowStateIn(contract, 'editing').entry = [
      read('sample.gone-list'),
      read('sample.list'),
      read('sample.page'),
      read('sample.save-button'),
      read('app-shell.devices-list'),
      read('sample.title-input.visibility-button'),
      read('sample.devices-button'),
      read('sample.plain-list'),
    ]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0].params.anchor: "sample.gone-list" is not a declared anchor`,
      `${AT}.states.editing.entry[1].params.anchor: "sample.list" lists the entity thing, which it follows as the stored data changes and never reads: ${may}`,
      `${AT}.states.editing.entry[2].params.anchor: "sample.page" is a page, which lists nothing: ${may}`,
      `${AT}.states.editing.entry[3].params.anchor: "sample.save-button" is a button, which lists nothing: ${may}`,
      `${AT}.states.editing.entry[4].params.anchor: "app-shell.devices-list" is an anchor of another screen: ${may}`,
      `${AT}.states.editing.entry[5].params.anchor: "sample.title-input.visibility-button" is a visibility-button, presentation only: ${may}`,
      `${AT}.states.editing.entry[6].params.anchor: "sample.devices-button" is a button, which lists nothing: ${may}`,
      `${AT}.states.editing.entry[7].params.anchor: "sample.plain-list" is a list with no source: ${may}`,
    ])
  })
  it('refuses an invoke that says read: false and reads in one of its outcomes', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    Object.assign(invoke, { read: false })

    expect(printed(contract)).toEqual([])

    invoke.onDone = { target: 'editing', actions: [read('sample.devices-list')] }
    invoke.onError = [
      { target: 'editing', guard: 'titleGiven' },
      { target: 'editing', actions: [read('sample.devices-list')] },
    ]

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.read: says nothing reads after thing.updateThing, and its onDone reads "sample.devices-list": a read after the action, or read: false, never both`,
      `${AT}.states.saving.invoke.read: says nothing reads after thing.updateThing, and its onError[1] reads "sample.devices-list": a read after the action, or read: false, never both`,
    ])
  })
  it('takes read: false on a branch of an onDone or an onError, a single outcome included', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    invoke.onDone = [
      { target: 'editing', guard: 'titleGiven', read: false },
      { target: 'editing', actions: [read('sample.devices-list')] },
    ]
    invoke.onError = { target: 'editing', read: false }

    expect(printed(contract)).toEqual([])
  })
  it('refuses read: false on a transition of an event, of a root, a region or a parallel state', () => {
    const contract = withAreas()

    flowStateIn(contract, 'saving').on = { 'sample.b-button': { target: 'editing', read: false } }
    parallelIn(contract).on = {
      'sample.save-button': [
        { guard: 'titleGiven', target: 'saving' },
        { actions: [show('sample.save-button', ['failed'])], read: false },
      ],
    }
    regionStateIn(contract, 'form', 'closed').on = {
      'sample.a-button': { target: 'open', read: false },
    }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"][1].read: says nothing reads after it, which only an outcome of an action says: read: false sits on a branch of an invoke's onDone or onError`,
      `${AT}.states.editing.states.form.states.closed.on["sample.a-button"].read: says nothing reads after it, which only an outcome of an action says: read: false sits on a branch of an invoke's onDone or onError`,
      `${AT}.states.saving.on["sample.b-button"].read: says nothing reads after it, which only an outcome of an action says: read: false sits on a branch of an invoke's onDone or onError`,
    ])
  })
  it('refuses a branch that says read: false and reads, once per read', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.devices-table': { kind: 'table', source: { platform: 'devices.list' } },
    })
    invoke.onDone = [
      {
        target: 'editing',
        guard: 'titleGiven',
        read: false,
        actions: [read('sample.devices-list'), read('sample.devices-table')],
      },
      { target: 'editing' },
    ]
    invoke.onError = { target: 'editing', read: false, actions: [read('sample.devices-list')] }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.onDone[0].read: says nothing reads after this outcome of thing.updateThing, and the outcome reads "sample.devices-list": a read after this outcome, or read: false, never both`,
      `${AT}.states.saving.invoke.onDone[0].read: says nothing reads after this outcome of thing.updateThing, and the outcome reads "sample.devices-table": a read after this outcome, or read: false, never both`,
      `${AT}.states.saving.invoke.onError.read: says nothing reads after this outcome of thing.updateThing, and the outcome reads "sample.devices-list": a read after this outcome, or read: false, never both`,
    ])
  })
  it('refuses a branch that says read: false under an invoke that says it of every outcome', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    Object.assign(invoke, { read: false })
    invoke.onDone = [{ target: 'editing', guard: 'titleGiven', read: false }, { target: 'editing' }]
    invoke.onError = { target: 'editing', read: false }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.onDone[0].read: says nothing reads after this outcome of thing.updateThing, and the invoke says it of every outcome already: read: false on the invoke or on its branch, never both`,
      `${AT}.states.saving.invoke.onError.read: says nothing reads after this outcome of thing.updateThing, and the invoke says it of every outcome already: read: false on the invoke or on its branch, never both`,
    ])
  })
  it('holds the effects of every transition, an invoke outcome included', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    invoke.onDone = { target: 'editing', actions: [show('sample.page', ['saved'])] }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.onDone.actions[0].params.codes[0]: "sample.page" carries no code "saved"`,
    ])
  })
  it('wants every guard declared in meta.guards and every declared guard used', () => {
    const contract = sampleContract()

    flowIn(contract).meta = { guards: { titleSet: 'the title is set' } }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"][0].guard: "titleGiven" is not a guard of meta.guards`,
      `${AT}.meta.guards.titleSet: is declared but no transition uses it`,
    ])

    flowIn(contract).meta = { guards: { toString: 'a name of the prototype' } }
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.home-link': { guard: 'valueOf', target: 'saving' },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"][0].guard: "titleGiven" is not a guard of meta.guards`,
      `${AT}.states.editing.on["sample.home-link"].guard: "valueOf" is not a guard of meta.guards`,
      `${AT}.meta.guards.toString: is declared but no transition uses it`,
    ])
  })
  it('wants every state reachable from the initial one', () => {
    const contract = sampleContract()

    flowIn(contract).states['idle'] = { on: { 'sample.a-button': { target: 'editing' } } }

    expect(printed(contract)).toEqual([`${AT}.states.idle: is not reachable from "editing"`])
  })
  it('wants every state that is not final to have a way out', () => {
    const contract = sampleContract()

    flowStateIn(contract, 'editing').on = {
      'sample.save-button': { target: 'saving' },
      'sample.b-button': { target: 'stuck' },
      'sample.a-button': { target: 'done' },
    }
    flowIn(contract).states['stuck'] = { on: {} }
    flowIn(contract).states['done'] = { type: 'final' }
    flowIn(contract).meta = {}

    expect(printed(contract)).toEqual([
      `${AT}.states.stuck: is not final and has no event or invoke to leave it`,
    ])
  })
  it('wants at most one transition without a guard per event, and that one last', () => {
    const contract = sampleContract()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    flowStateIn(contract, 'editing').on = {
      'sample.save-button': [{ target: 'saving' }, { guard: 'titleGiven', target: 'editing' }],
      'sample.a-button': [{ target: 'saving' }, { target: 'editing' }],
    }
    invoke.onError = [{ target: 'editing' }, { target: 'saving' }]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"]: the transition without a guard is not the last`,
      `${AT}.states.editing.on["sample.a-button"]: holds more than one transition without a guard`,
      `${AT}.states.saving.invoke.onError: holds more than one transition without a guard`,
    ])
  })
  it("wants a state's address to be a binding of its screen and that binding's search", () => {
    const contract = sampleContract()

    flowStateIn(contract, 'editing').meta = { address: { path: '/sample', search: { tab: 'a' } } }
    flowStateIn(contract, 'saving').meta = { address: { search: { tab: 'b', page: 1 } } }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.meta.address.path: "/sample" is the path of no binding of the screen`,
      `${AT}.states.saving.meta.address.search.page: "page" is not a search parameter of "/sample/$key"`,
    ])
  })
})
