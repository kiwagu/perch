import { describe, expect, it } from 'vitest'

import { confirmationsProblems } from './confirmations'
import type { Contract } from './contract'
import { sampleContract, screenIn } from './contract.fixture'

const DIALOG = 'app-shell.confirmation'

/** The sample with the frame's reserved confirmation, as it asks before a destructive action. */
function confirming(): Contract {
  const contract = sampleContract()

  screenIn(contract, 'app-shell').anchors[DIALOG] = {
    kind: 'confirmation',
    derived: ['confirm-button', 'cancel-button'],
  }
  contract.screens.platform.reserved = [...contract.screens.platform.reserved, DIALOG]

  return contract
}

const messages = (contract: Contract): string[] =>
  confirmationsProblems(contract).map(({ message }) => message)

describe('confirmationsProblems', () => {
  it('finds nothing without a confirmation, nor with one on the frame that asks as it should', () => {
    expect(messages(sampleContract())).toEqual([])
    expect(messages(confirming())).toEqual([])
  })

  it('wants it on the frame, once', () => {
    const elsewhere = confirming()

    screenIn(elsewhere, 'sample').anchors['sample.confirmation'] = {
      kind: 'confirmation',
      derived: ['confirm-button', 'cancel-button'],
    }

    expect(messages(elsewhere)).toEqual([
      'anchors["sample.confirmation"]: a confirmation asks for the whole app: only the frame declares it',
      'anchors["sample.confirmation"]: the frame declares one confirmation; app-shell.confirmation is the other',
    ])
  })

  it('wants it reserved, with both answers, running no action of its own', () => {
    const contract = confirming()
    const dialog = screenIn(contract, 'app-shell').anchors[DIALOG]

    contract.screens.platform.reserved = ['app-shell.status']
    Object.assign(dialog ?? {}, {
      derived: ['confirm-button'],
      binding: { action: 'platform.sign-out' },
    })

    expect(messages(contract)).toEqual([
      'anchors["app-shell.confirmation"]: "app-shell.confirmation" is not a reserved anchor of the frame',
      'anchors["app-shell.confirmation"]: "app-shell.confirmation" renders no cancel-button: going on and staying are its two answers',
      'anchors["app-shell.confirmation"]: "app-shell.confirmation" is bound; it runs nothing of its own, its confirm-button only lets the action that opened it run',
    ])
  })

  it('wants every question asked of the confirmation, with a code it carries', () => {
    const contract = confirming()
    const dialog = screenIn(contract, 'app-shell').anchors[DIALOG]
    const save = screenIn(contract, 'sample').anchors['sample.save-button']

    Object.assign(dialog ?? {}, { codes: ['thing-delete'] })
    Object.assign(save ?? {}, { asks: { dialog: DIALOG, code: 'thing-delete' } })

    expect(messages(contract)).toEqual([])

    Object.assign(save ?? {}, { asks: { dialog: 'sample.other', code: 'thing-delete' } })

    expect(messages(contract)).toEqual([
      'anchors["sample.save-button"].asks: asks "sample.other", not the frame\'s confirmation app-shell.confirmation',
    ])

    Object.assign(save ?? {}, { asks: { dialog: DIALOG, code: 'invented' } })

    expect(messages(contract)).toEqual([
      'anchors["sample.save-button"].asks: asks with "invented", which app-shell.confirmation does not carry',
    ])
  })
})
