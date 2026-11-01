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
      `${AT}["sample.page"].source.entity: no entity "gadget" in the model`,
      `${AT}["sample.list"].source.order: entity "thing" has no field "rank"`,
      `${AT}["sample.devices-list"].source.platform: no platform action "devices.all"`,
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
})
