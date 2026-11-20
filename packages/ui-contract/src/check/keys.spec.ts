import { describe, expect, it } from 'vitest'

import type { Contract } from './contract'
import { anchorIn, flowIn, sampleContract, screenIn } from './contract.fixture'
import { keyProblems } from './keys'

const FILE = 'contract/domain/screens/sample/$key.yaml'
const TOKEN = 'bindings[0].search.properties.token'
const KEY = `${TOKEN}["x-perch"].key`

/** What runs the action that takes the token: an invoke of the flow, a list's source, or nothing. */
type By = 'invoke' | 'source' | 'nothing'

/**
 * The sample with a search parameter `token` of its route marked `x-perch` as `perch`, a platform
 * value `token`, and the platform action `things.open`, taking a token into its parameter written
 * as `parameter` and failing with `link-invalid`, which `by` runs with `{ search: token }`.
 */
function keyed(
  perch: Record<string, unknown>,
  by: By,
  parameter: Record<string, unknown> = { value: 'token' },
): Contract {
  const contract = sampleContract()
  const { platform } = contract.screens
  const [binding] = screenIn(contract, 'sample').bindings

  if (binding?.search === undefined) {
    throw new Error('the sample route has a search')
  }

  platform.values = {
    token: { type: 'string', minLength: 1, maxLength: 4096, description: 'A token.' },
  }
  platform.actions['things.open'] = {
    description: 'Opens the thing a token names.',
    params: { token: { description: 'The token.', ...parameter } },
    result: 'the thing',
    codes: ['link-invalid', 'failed'],
    changes: [],
  }
  binding.search.properties['token'] = { type: 'string', minLength: 1, 'x-perch': perch }

  if (by === 'invoke') {
    flowIn(contract).states['opening'] = {
      invoke: {
        src: 'platform.things.open',
        input: { token: { search: 'token' } },
        onDone: { target: 'editing' },
        onError: { target: 'editing' },
      },
    }
  }

  if (by === 'source') {
    anchorIn(contract, 'sample.devices-list').source = {
      platform: 'things.open',
      params: { token: { search: 'token' } },
    }
  }

  return contract
}

describe('keyProblems', () => {
  it('passes a contract that writes no key', () => {
    expect(keyProblems(sampleContract())).toEqual([])
  })
  it("passes a key that is a code of the action an invoke's input passes the parameter to", () => {
    expect(keyProblems(keyed({ key: 'link-invalid' }, 'invoke'))).toEqual([])
  })
  it("passes a key that is a code of the action a source's params pass the parameter to", () => {
    expect(keyProblems(keyed({ key: 'link-invalid' }, 'source'))).toEqual([])
  })
  it('passes a key beside the controls that set the parameter', () => {
    const contract = keyed({ key: 'failed', control: 'sample.mode-select' }, 'invoke')

    expect(keyProblems(contract)).toEqual([])
  })
  it('passes a key whose action of the model takes it into the field a parameter sets', () => {
    const contract = keyed({ key: 'failed' }, 'nothing')

    flowIn(contract).states['opening'] = {
      invoke: {
        src: 'thing.updateThing',
        input: { title: { search: 'token' } },
        onDone: { target: 'editing' },
      },
    }

    expect(keyProblems(contract)).toEqual([])
  })
  it('refuses a key whose code the action that takes the parameter lacks, naming the action', () => {
    expect(keyProblems(keyed({ key: 'link-expired' }, 'invoke'))).toEqual([
      {
        file: FILE,
        message: `${KEY}: "link-expired" is no code of the actions that take "token": platform.things.open`,
      },
    ])
  })
  it('refuses a key on a parameter no action of the screen takes', () => {
    expect(keyProblems(keyed({ key: 'link-invalid' }, 'nothing'))).toEqual([
      {
        file: FILE,
        message: `${KEY}: no action the screen runs takes "token" as { search: token } (an invoke's input or a source's params), so it is the key of nothing`,
      },
    ])
  })
  it('refuses a key taken into a parameter that refers to no value, once however often it runs', () => {
    const contract = keyed({ key: 'link-invalid' }, 'invoke', { type: 'string', minLength: 1 })
    const flow = flowIn(contract)
    const opening = flow.states['opening']

    if (opening === undefined) {
      throw new Error('the keyed sample opens in the state opening')
    }

    flow.states['reopening'] = structuredClone(opening)

    expect(keyProblems(contract)).toEqual([
      {
        file: FILE,
        message: `${KEY}: "token" goes to the parameter "token" of platform.things.open, which refers to no value: the value the key must keep is the value its action takes`,
      },
    ])
  })
  it('refuses a second key on one route, at the second', () => {
    const contract = keyed({ key: 'link-invalid' }, 'invoke')
    const [binding] = screenIn(contract, 'sample').bindings
    const tab = binding?.search?.properties['tab']

    if (tab?.['x-perch'] === undefined) {
      throw new Error('the sample route has a tab with its controls')
    }

    tab['x-perch'].key = 'failed'

    expect(keyProblems(contract)).toEqual([
      {
        file: FILE,
        message: `bindings[0].search.properties.tab["x-perch"].key: no action the screen runs takes "tab" as { search: tab } (an invoke's input or a source's params), so it is the key of nothing`,
      },
      {
        file: FILE,
        message: `${KEY}: a route has one key, and "tab" is its key already`,
      },
    ])
  })
  it('refuses a default on a key, which would fill the value the key says is missing', () => {
    const contract = keyed({ key: 'link-invalid' }, 'invoke')
    const token = screenIn(contract, 'sample').bindings[0]?.search?.properties['token']

    if (token === undefined) {
      throw new Error('the sample route has a token')
    }

    token.default = 'none'

    expect(keyProblems(contract)).toEqual([
      {
        file: FILE,
        message: `${TOKEN}.default: a key has no default: the address that leaves "token" out is the failure "link-invalid"`,
      },
    ])
  })
})
