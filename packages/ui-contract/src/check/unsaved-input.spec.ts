import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'
import { fixtureContract } from '../manifest/manifest.fixture'

import type { Contract } from './contract'
import { unsavedInputProblems } from './unsaved-input'

const QUESTION = 'sample.leave-dialog'

/** The fixture with a reserved dialog that asks, and every leave declared. */
function asking(): Contract {
  const contract = fixtureContract()
  const [screen] = contract.screens.screens

  if (screen === undefined) {
    throw new Error('the fixture has no screen')
  }

  screen.anchors[QUESTION] = {
    kind: 'dialog',
    codes: ['saved'],
    derived: ['confirm-button', 'cancel-button'],
  }
  contract.screens.platform.reserved = [...contract.screens.platform.reserved, QUESTION]
  contract.screens.platform.leaving = ['platform.sign-out']
  contract.screens.platform.unsavedInput = {
    question: QUESTION,
    screen: 'question',
    actions: 'question',
    unload: 'browser',
    state: 'never',
    flow: 'never',
    elsewhere: 'cannot',
  }

  return contract
}

const printed = (contract: Contract): string[] => unsavedInputProblems(contract).map(formatProblem)

describe('unsavedInputProblems', () => {
  it('accepts every leave declared, asked through a reserved dialog with its code and both answers', () => {
    expect(printed(asking())).toEqual([])
  })

  it('accepts a contract that declares neither', () => {
    expect(printed(fixtureContract())).toEqual([])
  })

  it('wants the leaving actions to come with the declaration of how a leave asks', () => {
    const contract = fixtureContract()

    contract.screens.platform.leaving = ['platform.sign-out']

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: leaving: the leaving actions ask as unsavedInput says, and the platform does not declare it',
    ])
  })

  it('wants the question to be a reserved dialog with a code, a confirm-button and a cancel-button', () => {
    const contract = asking()
    const [screen] = contract.screens.screens

    if (screen === undefined) {
      throw new Error('the fixture has no screen')
    }

    screen.anchors[QUESTION] = { kind: 'message', derived: ['confirm-button'] }
    contract.screens.platform.reserved = contract.screens.platform.reserved.filter(
      (anchor) => anchor !== QUESTION,
    )

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: unsavedInput.question: "sample.leave-dialog" is a message, not a dialog',
      'contract/domain/platform.yaml:1: unsavedInput.question: "sample.leave-dialog" is not a reserved anchor of the frame',
      'contract/domain/platform.yaml:1: unsavedInput.question: "sample.leave-dialog" carries no code: its code names what it asks',
      'contract/domain/platform.yaml:1: unsavedInput.question: "sample.leave-dialog" renders no cancel-button: leaving and staying are its two answers',
    ])
  })

  it('names a question that is not declared, and actions that ask with none listed', () => {
    const contract = asking()
    const declaration = contract.screens.platform.unsavedInput

    if (declaration === undefined) {
      throw new Error('the declaration is missing')
    }

    contract.screens.platform.unsavedInput = { ...declaration, question: 'sample.gone-dialog' }
    contract.screens.platform.leaving = []

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: unsavedInput.actions: the controls ask before an action of leaving, and none is listed',
      'contract/domain/platform.yaml:1: unsavedInput.question: "sample.gone-dialog" is not a declared anchor',
    ])
  })
})
