import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { bindingsProblems } from './bindings'
import { anchorIn, sampleContract, screenIn } from './contract.fixture'

const printed = (contract = sampleContract()): string[] =>
  bindingsProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: anchors'

describe('bindingsProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('wants a model binding to name an entity and one of its fields', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').binding = { model: 'thing.name' }
    anchorIn(contract, 'sample.page').binding = { model: 'gadget.title' }

    expect(printed(contract)).toEqual([
      `${AT}["sample.page"].binding.model: no entity "gadget" in the model`,
      `${AT}["sample.title-input"].binding.model: entity "thing" has no field "name"`,
    ])
  })
  it('wants an action binding to name an entity action or a platform action', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.save-button').binding = [
      { action: 'thing.renameThing' },
      { action: 'gadget.createGadget' },
      { action: 'platform.sign-in' },
    ]

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding[0].action: entity "thing" has no action "renameThing"`,
      `${AT}["sample.save-button"].binding[1].action: no entity "gadget" in the model`,
      `${AT}["sample.save-button"].binding[2].action: no platform action "sign-in"`,
    ])
  })
  it('wants params keys to be parameters of the action and their anchors declared', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.createThing',
      params: { title: 'sample.gone-input', colour: { value: 'red' } },
    }
    anchorIn(contract, 'sample.sign-out-button').binding = {
      action: 'platform.sign-out',
      params: { everywhere: { value: true }, forgetUnsent: 'sample.mode-select.option' },
    }

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding.params.title: "sample.gone-input" is not a declared anchor`,
      `${AT}["sample.save-button"].binding.params.colour: "colour" is not a parameter of "thing.createThing"`,
      `${AT}["sample.sign-out-button"].binding.params.everywhere: "everywhere" is not a parameter of "platform.sign-out"`,
    ])
  })
  it('wants a search param to be a search parameter of every route of the screen', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.updateThing',
      params: { title: { search: 'tab' }, id: { search: 'token' } },
    }

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding.params.id: "token" is not a search parameter of every route of the screen`,
    ])
  })
  it('wants a search param on every route of the screen, not on one of them', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').bindings.push({
      path: '/sample',
      roles: ['member'],
      history: 'push',
    })
    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.updateThing',
      params: { title: { search: 'tab' } },
    }

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding.params.title: "tab" is not a search parameter of every route of the screen`,
    ])
  })
  it('starts a field with a search parameter every route of the screen declares', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').binding = [
      { search: 'tab' },
      { action: 'thing.updateThing', params: { title: 'sample.title-input' } },
    ]
    anchorIn(contract, 'sample.mode-select').binding = { search: 'tab' }

    expect(printed(contract)).toEqual([])
  })
  it('starts only a field with a search parameter, and only one every route declares', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').binding = { search: 'token' }
    anchorIn(contract, 'sample.save-button').binding = { search: 'tab' }
    anchorIn(contract, 'sample.list').binding = { search: 'tab' }
    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.search-input': { kind: 'input', binding: { search: 'tab' } },
    })

    expect(printed(contract)).toEqual([
      'contract/domain/screens/__root.yaml:1: anchors["app-shell.search-input"].binding.search: "tab" is not a search parameter of every route of the screen',
      `${AT}["sample.title-input"].binding.search: "token" is not a search parameter of every route of the screen`,
      `${AT}["sample.save-button"].binding.search: a button starts with no search parameter: only a field holds a value to start with`,
      `${AT}["sample.list"].binding.search: a list starts with no search parameter: only a field holds a value to start with`,
    ])
  })
  it('never starts a secret field with a search parameter: a secret never comes from a URL', () => {
    const contract = sampleContract()

    Object.assign(anchorIn(contract, 'sample.title-input'), {
      secret: true,
      binding: [
        { search: 'tab' },
        { action: 'thing.updateThing', params: { title: 'sample.title-input' } },
      ],
    })

    expect(printed(contract)).toEqual([
      `${AT}["sample.title-input"].binding[0].search: a secret field starts with no search parameter: a secret never comes from a URL`,
    ])
  })
  it('reports a name of the object prototype as unknown, never as found or thrown', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').binding = { model: 'thing.toString' }
    anchorIn(contract, 'sample.save-button').binding = [
      { action: 'platform.constructor' },
      { action: 'thing.hasOwnProperty' },
      { action: 'constructor.toString' },
    ]
    anchorIn(contract, 'sample.list').source = { entity: 'thing', order: 'valueOf' }
    anchorIn(contract, 'sample.devices-list').source = { platform: 'toString' }

    expect(printed(contract)).toEqual([
      `${AT}["sample.title-input"].binding.model: entity "thing" has no field "toString"`,
      `${AT}["sample.save-button"].binding[0].action: no platform action "constructor"`,
      `${AT}["sample.save-button"].binding[1].action: entity "thing" has no action "hasOwnProperty"`,
      `${AT}["sample.save-button"].binding[2].action: no entity "constructor" in the model`,
      `${AT}["sample.list"].source.order: entity "thing" has no field "valueOf"`,
      `${AT}["sample.devices-list"].source.platform: no platform action "toString"`,
    ])
  })
  it('leaves out the minted id and any parameter the view computes', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.save-button').binding = { action: 'thing.createThing' }

    expect(printed(contract)).toEqual([])
  })
  it('wants a route binding to be the path of a binding', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.home-link').binding = { route: '/sample' }

    expect(printed(contract)).toEqual([
      `${AT}["sample.home-link"].binding.route: "/sample" is the path of no binding`,
    ])
  })
  it('wants a source to name an entity and its field, or a platform action', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.list').source = { entity: 'thing', order: 'rank' }
    anchorIn(contract, 'sample.devices-list').source = { platform: 'devices.all' }
    anchorIn(contract, 'sample.page').source = { entity: 'gadget' }

    expect(printed(contract)).toEqual([
      `${AT}["sample.page"].source: a page has no entries: a source sits on a list, a section or a table`,
      `${AT}["sample.page"].source.entity: no entity "gadget" in the model`,
      `${AT}["sample.list"].source.order: entity "thing" has no field "rank"`,
      `${AT}["sample.devices-list"].source.platform: no platform action "devices.all"`,
    ])
  })
  it('keeps a source to a list, a section or a table', () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.devices-section': { kind: 'section', source: { platform: 'devices.list' } },
      'sample.devices-table': { kind: 'table', source: { platform: 'devices.list' } },
    })
    anchorIn(contract, 'sample.save-button').source = { platform: 'devices.list' }

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].source: a button has no entries: a source sits on a list, a section or a table`,
    ])
  })
  it('resolves a derived anchor of a param only through its base derived', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.createThing',
      params: { title: 'sample.title-input.item' },
    }

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding.params.title: "sample.title-input.item" is not a declared anchor`,
    ])
  })
  it("refuses a visibility-button as a param's anchor, and keeps its input", () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').derived = ['visibility-button']
    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.createThing',
      params: { title: 'sample.title-input.visibility-button' },
    }

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding.params.title: "sample.title-input.visibility-button" is a visibility-button: presentation only, never a value an action takes`,
    ])

    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.createThing',
      params: { title: 'sample.title-input' },
    }

    expect(printed(contract)).toEqual([])
  })
  it("takes an entry's data-id as a param from a control in the entry's part", () => {
    const contract = sampleContract()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.remove-button': {
        kind: 'button',
        binding: { action: 'thing.updateThing', params: { id: 'sample.thing-item' } },
      },
    })

    expect(printed(contract)).toEqual([])
  })
  it('refuses an entry param outside its part, on the entry, or that no list holds', () => {
    const contract = sampleContract()
    const update = (id: string) => ({ action: 'thing.updateThing', params: { id } })

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.form.remove-button': { kind: 'button', binding: update('sample.thing-item') },
      'sample.bare-item': { kind: 'item', binding: update('sample.bare-item') },
      'sample.lone.thing-item': { kind: 'item', dataId: 'thing' },
      'sample.lone.remove-button': { kind: 'button', binding: update('sample.lone.thing-item') },
      'sample.frame-button': { kind: 'button', binding: update('app-shell.thing-item') },
    })
    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.thing-item': { kind: 'item', dataId: 'thing' },
    })

    expect(printed(contract)).toEqual([
      `${AT}["sample.form.remove-button"].binding.params.id: takes the data-id of "sample.thing-item" on "sample.form.remove-button", which is not in its part "sample": only a control in the item's part, rendered in each entry, carries it`,
      `${AT}["sample.bare-item"].binding.params.id: "sample.bare-item" declares no dataId: a parameter takes the data-id of an entry, which its dataId says`,
      `${AT}["sample.bare-item"].binding.params.id: takes the data-id of "sample.bare-item" on the entry itself, which is no control: a control in it (a link) carries it`,
      `${AT}["sample.lone.remove-button"].binding.params.id: "sample.lone.thing-item" is an entry of no list, table or section of the screen: an entry is declared under its container or beside it in its part`,
      `${AT}["sample.frame-button"].binding.params.id: "app-shell.thing-item" is an anchor of another screen: a parameter takes the data-id of an entry of its own screen`,
    ])
  })
})
