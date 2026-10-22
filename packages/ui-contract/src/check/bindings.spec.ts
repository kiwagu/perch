import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { bindingsProblems } from './bindings'
import { anchorIn, sampleContract, screenIn } from './contract.fixture'

const printed = (contract = sampleContract()): string[] =>
  bindingsProblems(contract).map(formatProblem)

const AT = 'contract/screens/sample/$key.yaml:1: anchors'

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
  it('checks the action, the params, the anchor and the route of a flow event', () => {
    const contract = sampleContract()
    const flow = screenIn(contract, 'sample').flow

    flow?.events.push({
      on: 'sample.gone-button',
      action: 'thing.updateThing',
      params: { size: { value: 3 } },
      outcomes: { success: { route: '/nowhere' }, failure: { route: '/sample/$key' } },
    })

    expect(printed(contract)).toEqual([
      'contract/screens/sample/$key.yaml:1: flow.events[1].on: "sample.gone-button" is not a declared anchor',
      'contract/screens/sample/$key.yaml:1: flow.events[1].params.size: "size" is not a parameter of "thing.updateThing"',
      'contract/screens/sample/$key.yaml:1: flow.events[1].outcomes.success.route: "/nowhere" is the path of no binding',
    ])
  })
  it('resolves a derived anchor of a param or a flow event only through its base derived', () => {
    const contract = sampleContract()
    const event = screenIn(contract, 'sample').flow?.events[0]

    anchorIn(contract, 'sample.save-button').binding = {
      action: 'thing.createThing',
      params: { title: 'sample.title-input.item' },
    }
    Object.assign(event ?? {}, {
      on: 'sample.save-button.confirm-button',
      params: { title: 'sample.key-select.option' },
    })

    expect(printed(contract)).toEqual([
      `${AT}["sample.save-button"].binding.params.title: "sample.title-input.item" is not a declared anchor`,
      'contract/screens/sample/$key.yaml:1: flow.events[0].on: "sample.save-button.confirm-button" is not a declared anchor',
    ])
  })
})
