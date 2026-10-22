import { describe, expect, it } from 'vitest'

import { formatProblem, type Screen } from '../files'
import { fixtureContract } from '../manifest/manifest.fixture'

import { activitiesProblems } from './activities'
import type { Contract } from './contract'
import {
  activityIn,
  activityStateIn,
  flowStateIn,
  sampleContract,
  screenIn,
} from './contract.fixture'

const printed = (contract = sampleContract()): string[] =>
  activitiesProblems(contract).map(formatProblem)

const AT = 'contract/activities/thing.yaml:1:'

const SAMPLE = { screen: 'sample', address: { path: '/sample/$key' } }

/** A second screen, `/other`, with a link back to the sample. */
const OTHER: Screen = {
  id: 'other',
  title: 'Another screen',
  description: 'Somewhere else than the sample.',
  bindings: [{ path: '/other', roles: ['member'], history: 'push' }],
  flag: null,
  entry: ['other.page'],
  anchors: {
    'other.page': { kind: 'page' },
    'other.back-link': { kind: 'link', binding: { route: '/sample/$key' } },
  },
}

/** The sample contract with the other screen, and a final state of the activity on it. */
function withOther(): Contract {
  const contract = sampleContract()

  contract.screens.screens.push(structuredClone(OTHER))
  contract.screens.files = [...contract.screens.files, 'contract/screens/other.yaml']
  activityIn(contract).states['away'] = {
    type: 'final',
    meta: { screen: 'other', address: { path: '/other' } },
  }

  return contract
}

describe('activitiesProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('finds nothing in the activity of the fixture files', () => {
    expect(printed(fixtureContract())).toEqual([])
  })
  it('wants roles of the vocabulary and data that are fields of the model', () => {
    const contract = sampleContract()
    const activity = activityIn(contract)

    activity.roles = ['member', 'visitor']
    activity.data = {
      'thing.title': { description: 'Its title.', model: 'gadget.title' },
      colour: { description: 'Its colour.', model: 'thing.colour' },
    }

    expect(printed(contract)).toEqual([
      `${AT} roles[1]: "visitor" is not a role of the vocabulary`,
      `${AT} data["thing.title"].model: no entity "gadget" in the model`,
      `${AT} data.colour.model: entity "thing" has no field "colour"`,
    ])
  })
  it('wants the initial state and every target to be a state of the activity', () => {
    const contract = sampleContract()

    activityIn(contract).initial = 'opening'
    activityStateIn(contract, 'saved').on = { 'sample.home-link': { target: 'gone' } }

    expect(printed(contract)).toEqual([
      `${AT} initial: "opening" is not a state of the activity`,
      `${AT} states.saved.on["sample.home-link"].target: "gone" is not a state of the activity`,
      `${AT} states.editing: is not reachable from "opening"`,
      `${AT} states.saved: is not reachable from "opening"`,
      `${AT} states.home: is not reachable from "opening"`,
    ])
  })
  it("wants each state's screen to exist and its address to be a binding of that screen", () => {
    const contract = sampleContract()

    activityStateIn(contract, 'editing').meta.screen = 'gadget'
    activityStateIn(contract, 'saved').meta.address.path = '/elsewhere'
    activityStateIn(contract, 'home').meta.screen = 'app-shell'

    expect(printed(contract)).toEqual([
      `${AT} states.editing.meta.screen: "gadget" is not a screen`,
      `${AT} states.saved.meta.address.path: "/elsewhere" is the path of no binding of "sample"`,
      `${AT} states.home.meta.address.path: "/sample/$key" is the path of no binding of "app-shell"`,
    ])
  })
  it("wants each event to be a declared anchor of the state's screen or of the frame", () => {
    const contract = withOther()

    activityStateIn(contract, 'saved').on = {
      'sample.home-link': { target: 'home' },
      'sample.gone-button': { target: 'home' },
      'other.back-link': { target: 'away' },
    }

    expect(printed(contract)).toEqual([
      `${AT} states.saved.on["sample.gone-button"]: "sample.gone-button" is not a declared anchor`,
      `${AT} states.saved.on["other.back-link"]: "other.back-link" is an anchor of "other", not of "sample" or the frame`,
    ])
  })
  it("wants each transition backed by the screen's flow navigating to the target's address, or by a link to it", () => {
    const contract = withOther()

    activityStateIn(contract, 'editing').on = {
      'sample.save-button': [{ guard: 'titleGiven', target: 'saved' }, { target: 'away' }],
    }
    activityStateIn(contract, 'saved').on = {
      'sample.home-link': [{ guard: 'titleGiven', target: 'away' }, { target: 'home' }],
      'sample.page': { target: 'home' },
    }

    expect(printed(contract)).toEqual([
      `${AT} states.editing.on["sample.save-button"][1]: "sample.save-button" leads to "/other" through neither a navigate of the flow of "sample" nor a link`,
      `${AT} states.saved.on["sample.home-link"][0]: "sample.home-link" leads to "/other" through neither a navigate of the flow of "sample" nor a link`,
      `${AT} states.saved.on["sample.page"]: "sample.page" leads to "/sample/$key" through neither a navigate of the flow of "sample" nor a link`,
    ])
  })
  it('backs a transition by a navigate on leaving a state, on the event or after an invoke', () => {
    for (const leaving of ['editing', 'saving']) {
      const contract = withOther()

      flowStateIn(contract, leaving).exit = [{ type: 'navigate', params: { to: '/other' } }]
      activityStateIn(contract, 'editing').on = {
        'sample.save-button': [{ guard: 'titleGiven', target: 'saved' }, { target: 'away' }],
      }

      expect(printed(contract), leaving).toEqual([])
    }
  })
  it('backs no transition by a navigate on leaving a state the flow stays in', () => {
    const contract = withOther()
    const editing = flowStateIn(contract, 'editing')

    editing.exit = [{ type: 'navigate', params: { to: '/other' } }]
    editing.on = { ...editing.on, 'sample.a-button': { description: 'Nothing moves.' } }
    activityStateIn(contract, 'saved').on = { 'sample.a-button': { target: 'away' } }

    expect(printed(contract)).toEqual([
      `${AT} states.saved.on["sample.a-button"]: "sample.a-button" leads to "/other" through neither a navigate of the flow of "sample" nor a link`,
      `${AT} states.home: is not reachable from "editing"`,
    ])
  })
  it("backs a frame anchor by the frame's flow, through its invoke's onDone and onError", () => {
    const contract = sampleContract()
    const frame = screenIn(contract, 'app-shell')

    frame.anchors['app-shell.home-button'] = { kind: 'button' }
    frame.flow = {
      initial: 'ready',
      states: {
        ready: { on: { 'app-shell.home-button': { target: 'going' } } },
        going: {
          invoke: {
            src: 'platform.sign-out',
            onDone: { target: 'ready' },
            onError: {
              target: 'left',
              actions: [{ type: 'navigate', params: { to: '/sample/$key' } }],
            },
          },
        },
        left: { type: 'final' },
      },
    }
    activityStateIn(contract, 'saved').on = { 'app-shell.home-button': { target: 'home' } }

    expect(printed(contract)).toEqual([])

    delete frame.flow

    expect(printed(contract)).toEqual([
      `${AT} states.saved.on["app-shell.home-button"]: "app-shell.home-button" leads to "/sample/$key" through neither a navigate of the flow of "app-shell" nor a link`,
    ])
  })
  it('wants every guard declared in meta.guards, and every declared one used', () => {
    const contract = sampleContract()

    activityStateIn(contract, 'editing').on = {
      'sample.save-button': [{ guard: 'nameGiven', target: 'saved' }],
    }

    expect(printed(contract)).toEqual([
      `${AT} states.editing.on["sample.save-button"][0].guard: "nameGiven" is not a guard of meta.guards`,
      `${AT} meta.guards.titleGiven: is declared but no transition uses it`,
    ])
  })
  it('wants every state reachable, and every state that is not final to leave', () => {
    const contract = sampleContract()

    activityIn(contract).states['lost'] = { meta: structuredClone(SAMPLE) }

    expect(printed(contract)).toEqual([
      `${AT} states.lost: is not reachable from "editing"`,
      `${AT} states.lost: is not final and has no transition to leave it`,
    ])
  })
})
