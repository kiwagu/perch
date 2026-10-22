import { describe, expect, it } from 'vitest'

import { formatProblem } from '../../files'
import { parallelIn, regionIn, regionStateIn, withAreas } from '../areas.fixture'
import type { Contract } from '../contract'
import { flowIn, flowStateIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/screens/sample/$key.yaml:1: flow'

const show = (anchor: string, codes: string[]) =>
  ({ type: 'show', params: { anchor, codes } }) as const

const IN = `${AT}.states.editing.states`

describe('flowProblems in a parallel state', () => {
  it('finds nothing in a consistent flow with a parallel state', () => {
    expect(printed(withAreas())).toEqual([])
  })
  it('wants the initial state of a region and every target in it to be a state of that region', () => {
    const contract = withAreas()

    regionStateIn(contract, 'side', 'idle').on = {
      'sample.b-button': { target: 'busy' },
      'sample.mode-select': [{ guard: 'titleGiven', target: 'closed' }, { target: 'saving' }],
      'sample.key-select': { target: 'editing.form.open' },
    }

    expect(printed(contract)).toEqual([
      `${IN}.side.states.idle.on["sample.mode-select"][0].target: "closed" is not a state of region "side"`,
      `${IN}.side.states.idle.on["sample.mode-select"][1].target: "saving" is not a state of region "side"`,
      `${IN}.side.states.idle.on["sample.key-select"].target: "editing.form.open" is not a state of region "side"`,
    ])

    const gone = withAreas()

    regionIn(gone, 'form').initial = 'gone'

    expect(printed(gone)).toEqual([
      `${IN}.form.initial: "gone" is not a state of region "form"`,
      `${IN}.form.states.closed: is not reachable from "gone"`,
      `${IN}.form.states.open: is not reachable from "gone"`,
    ])
  })
  it('reads a deep target of the root as a parallel state, a region of it and a state of that', () => {
    const contract = withAreas()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    invoke.onDone = { target: 'saving.form.open' }
    invoke.onError = { target: 'nowhere.form.open' }
    Object.assign(parallelIn(contract).on ?? {}, {
      'sample.home-link': { target: 'editing.gone.open' },
      'sample.sign-out-button': { target: 'editing.form.gone' },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.home-link"].target: "editing.gone.open": "gone" is not a region of "editing"`,
      `${AT}.states.editing.on["sample.sign-out-button"].target: "editing.form.gone": "gone" is not a state of region "form"`,
      `${AT}.states.saving.invoke.onDone.target: "saving.form.open": "saving" is not a parallel state`,
      `${AT}.states.saving.invoke.onError.target: "nowhere.form.open": "nowhere" is not a parallel state`,
    ])
  })
  it('reaches a parallel state through a deep target', () => {
    const contract = withAreas()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    flowIn(contract).initial = 'saving'
    invoke.onDone = { target: 'editing.form.open' }

    expect(printed(contract)).toEqual([])
  })
  it('wants an event handled by one area: one region, or the parallel state itself', () => {
    const contract = withAreas()

    regionStateIn(contract, 'side', 'idle').on = {
      'sample.b-button': { target: 'busy' },
      'sample.a-button': { target: 'busy' },
    }
    regionStateIn(contract, 'form', 'open').on = {
      'sample.a-button': { target: 'closed' },
      'sample.save-button': { target: 'closed' },
    }

    expect(printed(contract)).toEqual([
      `${IN}.form.states.open.on["sample.save-button"]: "sample.save-button" is handled by region "form" and by the state itself`,
      `${IN}.side.states.idle.on["sample.a-button"]: "sample.a-button" is handled by region "form" and by region "side"`,
    ])
  })
  it('reaches each state of a region from the initial state of that region', () => {
    const contract = withAreas()

    regionIn(contract, 'form').states['stray'] = { on: { 'sample.a-button': { target: 'closed' } } }

    expect(printed(contract)).toEqual([`${IN}.form.states.stray: is not reachable from "closed"`])
  })
  it('wants a way out of every state of a region, and none of a parallel state', () => {
    const contract = withAreas()
    const flow = flowIn(contract)

    delete parallelIn(contract).on
    delete flow.states['saving']
    flow.meta = {}
    regionIn(contract, 'side').states['busy'] = {}

    expect(printed(contract)).toEqual([
      `${IN}.side.states.busy: is not final and has no event or invoke to leave it`,
    ])
  })
  it('holds the events, effects, invokes, guards and address of a parallel state and its regions', () => {
    const contract = withAreas()
    const parallel = parallelIn(contract)
    const busy = regionStateIn(contract, 'side', 'busy').invoke ?? expect.unreachable('an invoke')

    parallel.meta = { address: { path: '/sample' } }
    parallel.exit = [{ type: 'navigate', params: { to: '/nowhere' } }]
    regionStateIn(contract, 'form', 'open').entry = [show('sample.save-button', ['gone'])]
    regionStateIn(contract, 'form', 'closed').on = {
      'sample.a-button': { guard: 'formOpen', target: 'open' },
    }
    Object.assign(regionStateIn(contract, 'side', 'idle').on ?? {}, {
      'sample.gone-button': { target: 'busy' },
    })
    Object.assign(busy, { src: 'thing.renameThing', input: {} })
    flowIn(contract).meta = { guards: { titleGiven: 'the title is given', unused: 'nothing' } }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.meta.address.path: "/sample" is the path of no binding of the screen`,
      `${AT}.states.editing.exit[0].params.to: "/nowhere" is the path of no binding`,
      `${IN}.form.states.closed.on["sample.a-button"].guard: "formOpen" is not a guard of meta.guards`,
      `${IN}.form.states.open.entry[0].params.codes[0]: "sample.save-button" carries no code "gone"`,
      `${IN}.side.states.idle.on["sample.gone-button"]: "sample.gone-button" is not a declared anchor`,
      `${IN}.side.states.busy.invoke.src: entity "thing" has no action "renameThing"`,
      `${AT}.meta.guards.unused: is declared but no transition uses it`,
    ])
  })
})
