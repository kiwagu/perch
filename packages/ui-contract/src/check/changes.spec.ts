import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { changesProblems } from './changes'
import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'

const printed = (contract: Contract): string[] => changesProblems(contract).map(formatProblem)

const NAMES =
  'changes names the reads whose answer differs once the action succeeds: other platform actions, each once, that a list, a section or a table takes as its source'

const PLATFORM = 'contract/domain/platform.yaml:1: actions'
const MODEL = 'contract/domain/model.schema.json:1: $defs.thing["x-perch"].actions'

/**
 * The sample contract, whose `sample.devices-list` reads `devices.list`, with `changes` written
 * on the platform action `sign-out` and on the model action `thing.updateThing`.
 */
function changing(platform: string[], model: string[]): Contract {
  const contract = sampleContract()
  const signOut = contract.screens.platform.actions['sign-out']
  const updateThing = contract.model.entities['thing']?.actions['updateThing']

  if (signOut === undefined || updateThing === undefined) {
    throw new Error('the sample lost sign-out or thing.updateThing')
  }

  signOut.changes = platform
  updateThing.changes = model

  return contract
}

describe('changesProblems', () => {
  it('finds nothing where no action says what it changes, or each names a read a list takes', () => {
    expect(printed(sampleContract())).toEqual([])
    expect(printed(changing(['devices.list'], ['devices.list']))).toEqual([])
    expect(printed(changing([], []))).toEqual([])
  })
  it('refuses a name that is not a platform action', () => {
    expect(printed(changing(['devices.nope'], ['platform.devices.list']))).toEqual([
      `${PLATFORM}["sign-out"].changes[0]: "devices.nope" is not a platform action: ${NAMES}`,
      `${MODEL}.updateThing.changes[0]: "platform.devices.list" is not a platform action: ${NAMES}`,
    ])
  })
  it('refuses a platform action that names itself: it changes what other reads answer', () => {
    const contract = changing([], [])
    const list = contract.screens.platform.actions['devices.list']

    if (list === undefined) {
      throw new Error('the sample lost devices.list')
    }

    list.changes = ['devices.list']

    expect(printed(contract)).toEqual([
      `${PLATFORM}["devices.list"].changes[0]: "devices.list" is the action itself: ${NAMES}`,
    ])
    expect(printed(changing(['sign-out'], []))).toEqual([
      `${PLATFORM}["sign-out"].changes[0]: "sign-out" is the action itself: ${NAMES}`,
    ])
  })
  it('refuses a platform action that no list, section or table takes as its source', () => {
    const contract = changing([], ['sign-out'])

    Object.assign(contract.screens.platform.actions, {
      'devices.revoke': {
        description: 'Signs one device out.',
        params: {},
        result: 'the device signs out',
        codes: ['failed'],
        changes: ['devices.list', 'sign-out'],
      },
    })

    expect(printed(contract)).toEqual([
      `${PLATFORM}["devices.revoke"].changes[1]: "sign-out" is the source of no list, section or table: ${NAMES}`,
      `${MODEL}.updateThing.changes[0]: "sign-out" is the source of no list, section or table: ${NAMES}`,
    ])
  })
  it('refuses a name written twice, once at each place after the first', () => {
    expect(
      printed(changing(['devices.list', 'devices.list'], ['devices.list', 'devices.list'])),
    ).toEqual([
      `${PLATFORM}["sign-out"].changes[1]: "devices.list" is named twice: ${NAMES}`,
      `${MODEL}.updateThing.changes[1]: "devices.list" is named twice: ${NAMES}`,
    ])
  })
})
