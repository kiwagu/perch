/**
 * The sample contract of `contract.fixture.ts` with a parallel state, for the specs of the
 * rules that read a flow's regions.
 */

import type { FlowParallelState, FlowRegion, FlowRegionState } from '../files'

import type { Contract } from './contract'
import { flowIn, flowStateIn, sampleContract } from './contract.fixture'

const show = (anchor: string, codes: string[]) =>
  ({ type: 'show', params: { anchor, codes } }) as const

/**
 * The sample flow with `editing` a parallel state of two areas: the form, closed or open on
 * `sample.a-button`, and a side area that creates a thing on `sample.b-button`. The save
 * button is the parallel state's own event, whatever each area is in, and a failed save
 * lands with the form open. The flow declares its id, the screen's, for id targets.
 */
export function withAreas(): Contract {
  const contract = sampleContract()
  const flow = flowIn(contract)
  const { invoke } = flowStateIn(contract, 'saving')

  if (invoke === undefined) {
    throw new Error('the sample saves through an invoke')
  }

  flow.id = 'sample'
  flow.states = {
    editing: {
      type: 'parallel',
      on: {
        'sample.save-button': [
          { guard: 'titleGiven', target: 'saving' },
          { actions: [show('sample.save-button', ['failed'])] },
        ],
      },
      states: {
        form: {
          initial: 'closed',
          states: {
            closed: { on: { 'sample.a-button': { target: 'open' } } },
            open: { on: { 'sample.a-button': { target: 'closed' } } },
          },
        },
        side: {
          initial: 'idle',
          states: {
            idle: { on: { 'sample.b-button': { target: 'busy' } } },
            busy: {
              invoke: {
                src: 'thing.createThing',
                input: { title: 'sample.title-input' },
                onDone: { target: 'idle' },
                onError: { target: 'idle', actions: [show('sample.save-button', ['failed'])] },
              },
            },
          },
        },
      },
    },
    saving: { invoke: { ...invoke, onError: { target: 'editing.form.open' } } },
  }

  return contract
}

/** The parallel state `editing` of the sample flow, for a spec to change. */
export function parallelIn(contract: Contract): FlowParallelState {
  const state = flowIn(contract).states['editing']

  if (state?.type !== 'parallel') {
    throw new Error('editing is no parallel state')
  }

  return state
}

/** The region `region` of `editing`, for a spec to change. */
export function regionIn(contract: Contract, region: string): FlowRegion {
  const found = parallelIn(contract).states[region]

  if (found === undefined) {
    throw new Error(`no region ${region}`)
  }

  return found
}

/** The state `name` of the region `region` of `editing`, for a spec to change. */
export function regionStateIn(contract: Contract, region: string, name: string): FlowRegionState {
  const state = regionIn(contract, region).states[name]

  if (state === undefined) {
    throw new Error(`no state ${name} in region ${region}`)
  }

  return state
}
