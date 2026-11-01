import { describe, expect, it } from 'vitest'

import { formatProblem } from '../../files'
import { flowIn, flowStateIn, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract = sampleContract()): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'

const show = (anchor: string, codes: string[]) =>
  ({ type: 'show', params: { anchor, codes } }) as const

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
    editing.exit = [
      { type: 'navigate', params: { to: '/nowhere' } },
      { type: 'navigate', params: { to: '/sample/$key', search: { page: 2, tab: 'b' } } },
    ]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0].params.anchor: "sample.gone-message" is not a declared anchor`,
      `${AT}.states.editing.entry[1].params.codes[0]: "sample.save-button" carries no code "gone"`,
      `${AT}.states.editing.exit[0].params.to: "/nowhere" is the path of no binding`,
      `${AT}.states.editing.exit[1].params.search.page: "page" is not a search parameter of "/sample/$key"`,
    ])
  })
  it('holds a clear to a declared anchor that carries codes', () => {
    const contract = sampleContract()
    const editing = flowStateIn(contract, 'editing')

    editing.entry = [
      { type: 'clear', params: { anchor: 'sample.gone-message' } },
      { type: 'clear', params: { anchor: 'sample.page' } },
      { type: 'clear', params: { anchor: 'sample.save-button' } },
    ]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0].params.anchor: "sample.gone-message" is not a declared anchor`,
      `${AT}.states.editing.entry[1].params.anchor: "sample.page" carries no code to clear`,
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
