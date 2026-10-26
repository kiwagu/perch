import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { bindingsProblems } from './bindings'
import type { Contract } from './contract'
import { sampleContract, screenIn } from './contract.fixture'
import { leavingProblems } from './leaving'
import { screensProblems } from './screens'
import { unsavedInputProblems } from './unsaved-input'
import { vocabularyProblems } from './vocabulary'

const QUESTION = 'app-shell.leave-dialog'

/** The sample with the frame's reserved dialog that asks, and every leave declared. */
function asking(): Contract {
  const contract = sampleContract()
  const { vocabulary, screens } = contract

  vocabulary.kinds['dialog'] = 'a modal question'
  vocabulary.suffixes['cancel-button'] = 'the button that closes a dialog without its action'
  vocabulary.codes['unsaved-input'] = { where: QUESTION, meaning: 'asks whether to leave' }
  vocabulary.reserved[QUESTION] = 'the question before a leave loses unsaved input'
  screenIn(contract, 'app-shell').anchors[QUESTION] = {
    kind: 'dialog',
    codes: ['unsaved-input'],
    derived: ['confirm-button', 'cancel-button'],
  }
  screens.platform.reserved = [...screens.platform.reserved, QUESTION]
  screens.platform.leaving = ['platform.sign-out']
  screens.platform.unsavedInput = {
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
  it('accepts every leave declared, asked through a reserved dialog of the frame', () => {
    const contract = asking()

    expect(printed(contract)).toEqual([])
    expect(
      [
        ...vocabularyProblems(contract),
        ...screensProblems(contract),
        ...bindingsProblems(contract),
        ...leavingProblems(contract),
      ].map(formatProblem),
    ).toEqual([])
  })

  it('accepts a contract that declares neither', () => {
    expect(printed(sampleContract())).toEqual([])
  })

  it('wants the leaving actions to come with the declaration of how a leave asks', () => {
    const contract = sampleContract()

    contract.screens.platform.leaving = ['platform.sign-out']

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: leaving: the leaving actions ask as unsavedInput says, and the platform does not declare it',
    ])
  })

  it('wants the question bound to no action: its confirm-button resumes the leave that opened it', () => {
    const contract = asking()

    const frame = screenIn(contract, 'app-shell')

    frame.anchors[QUESTION] = {
      kind: 'dialog',
      codes: ['unsaved-input'],
      derived: ['confirm-button', 'cancel-button'],
      binding: [
        { model: 'thing.title' },
        { action: 'platform.sign-out', params: { forgetUnsent: { value: true } } },
      ],
    }

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: unsavedInput.question: "app-shell.leave-dialog" runs "platform.sign-out"; its confirm-button only lets the leave that opened it go on',
    ])
  })

  it('wants the question to be a reserved dialog with a code, a confirm-button and a cancel-button', () => {
    const contract = asking()

    screenIn(contract, 'app-shell').anchors[QUESTION] = {
      kind: 'status',
      derived: ['confirm-button'],
    }
    contract.screens.platform.reserved = contract.screens.platform.reserved.filter(
      (anchor) => anchor !== QUESTION,
    )

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: unsavedInput.question: "app-shell.leave-dialog" is a status, not a dialog',
      'contract/domain/platform.yaml:1: unsavedInput.question: "app-shell.leave-dialog" is not a reserved anchor of the frame',
      'contract/domain/platform.yaml:1: unsavedInput.question: "app-shell.leave-dialog" carries no code: its code names what it asks',
      'contract/domain/platform.yaml:1: unsavedInput.question: "app-shell.leave-dialog" renders no cancel-button: leaving and staying are its two answers',
    ])
  })

  it('names a question that is not declared, and actions that ask with none listed', () => {
    const contract = asking()
    const declaration = contract.screens.platform.unsavedInput

    if (declaration === undefined) {
      throw new Error('the declaration is missing')
    }

    contract.screens.platform.unsavedInput = { ...declaration, question: 'app-shell.gone-dialog' }
    contract.screens.platform.leaving = []

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: unsavedInput.actions: the controls ask before an action of leaving, and none is listed',
      'contract/domain/platform.yaml:1: unsavedInput.question: "app-shell.gone-dialog" is not a declared anchor',
    ])
  })
})
