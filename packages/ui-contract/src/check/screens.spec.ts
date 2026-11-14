import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { anchorIn, sampleContract, screenIn } from './contract.fixture'
import { screensProblems } from './screens'

const printed = (contract = sampleContract()): string[] =>
  screensProblems(contract).map(formatProblem)

describe('screensProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('wants every anchor declared once across the screens', () => {
    const contract = sampleContract()

    screenIn(contract, 'app-shell').anchors['sample.page'] = { kind: 'page' }

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"]: also declared on screen "app-shell"',
      'contract/domain/screens/__root.yaml:1: anchors["sample.page"]: does not start with its screen\'s id "app-shell"',
    ])
  })
  it('refuses a declared anchor that reads as another one with a suffix', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.anchors['sample.list.item'] = { kind: 'item' }
    sample.anchors['sample.mode-select.option'] = { kind: 'option' }
    anchorIn(contract, 'sample.page').derived = ['pane-button']
    sample.anchors['sample.page.pane-button'] = { kind: 'button' }

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.list.item"]: reads as the anchor "sample.list" with the suffix "item"; a declared anchor is never named like a derived one',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.mode-select.option"]: reads as the anchor "sample.mode-select" with the suffix "option"; a declared anchor is never named like a derived one',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page.pane-button"]: reads as the anchor "sample.page" with the suffix "pane-button"; a declared anchor is never named like a derived one',
    ])
  })
  it('wants every entry anchor declared on its screen', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').entry = ['sample.page', 'app-shell.status', 'sample.gone-page']

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: entry[1]: "app-shell.status" is not declared on this screen',
      'contract/domain/screens/sample/$key.yaml:1: entry[2]: "sample.gone-page" is not declared on this screen',
    ])
  })
  it('accepts a derived entry of a declared base', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').entry = ['sample.mode-select.option']

    expect(printed(contract)).toEqual([])
  })
  it('wants a binding on a screen that is not the frame', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').bindings = []

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: bindings: a screen that is not the frame needs at least one binding',
    ])
  })
  it("holds an error's fields to its codes and to the fields of its screen", () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.anchors['sample.save-error'] = {
      kind: 'error',
      codes: ['title-required', 'failed'],
      fields: {
        'title-required': 'sample.title-input',
        failed: 'sample.save-button',
        missing: 'sample.title-input',
        'title-too-long': 'sample.gone-input',
      },
    }
    anchorIn(contract, 'sample.save-button').fields = { saved: 'sample.title-input' }

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-button"].fields: only an error names the fields its codes concern',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-error"].fields.failed: "sample.save-button" is a button, not a field',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-error"].fields.missing: "missing" is not a code of the anchor',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-error"].fields["title-too-long"]: "title-too-long" is not a code of the anchor',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-error"].fields["title-too-long"]: "sample.gone-input" is not an anchor of the screen',
    ])
  })
  it('says only a field holds input', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.page').holdsInput = true
    anchorIn(contract, 'sample.title-input').holdsInput = false

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].holdsInput: only a field holds input',
    ])
  })
  it('lets only a field that holds input drop its state colour', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').holdsInput = true
    anchorIn(contract, 'sample.page').marksState = false
    anchorIn(contract, 'sample.title-input').marksState = false

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].marksState: only a field that holds input shows a state colour',
    ])

    anchorIn(contract, 'sample.page').marksState = undefined
    anchorIn(contract, 'sample.title-input').holdsInput = false

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.title-input"].marksState: only a field that holds input shows a state colour',
    ])
  })
  it('takes a visibility-button on a secret input and refuses it on any other kind', () => {
    const contract = sampleContract()

    Object.assign(anchorIn(contract, 'sample.title-input'), {
      secret: true,
      derived: ['visibility-button'],
    })

    expect(printed(contract)).toEqual([])

    anchorIn(contract, 'sample.save-button').derived = ['visibility-button']
    anchorIn(contract, 'sample.mode-select').derived = ['option', 'visibility-button']

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-button"].derived[0]: only an input renders a visibility-button',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.mode-select"].derived[1]: only an input renders a visibility-button',
    ])
  })
  it('refuses an eye on an input that holds no secret: it shows what a secret field hides', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').derived = ['visibility-button']

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.title-input"].derived[0]: only a secret input renders a visibility-button: declare it secret: true',
    ])
  })
  it('takes secret on a field and refuses it on any other kind', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').secret = true
    anchorIn(contract, 'sample.mode-select').secret = true

    expect(printed(contract)).toEqual([])

    anchorIn(contract, 'sample.save-button').secret = true

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-button"].secret: only a field holds a secret',
    ])
  })
  it('takes ranked on a message of two codes or more, each once, and refuses it elsewhere', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.anchors['sample.status-message'] = {
      kind: 'message',
      codes: ['saved', 'failed'],
      ranked: true,
    }

    expect(printed(contract)).toEqual([])

    anchorIn(contract, 'sample.save-button').ranked = true
    sample.anchors['sample.saved-message'] = { kind: 'message', codes: ['saved'], ranked: true }
    sample.anchors['sample.again-message'] = {
      kind: 'message',
      codes: ['saved', 'failed', 'saved'],
      ranked: true,
    }

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.save-button"].ranked: only a message ranks its codes',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.saved-message"].ranked: a ranked message carries two codes or more',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.again-message"].codes[2]: "saved" is ranked twice',
    ])
  })
  it('wants every anchor to start with its screen id and end with its kind', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.anchors['app-shell.extra-button'] = { kind: 'button' }
    anchorIn(contract, 'sample.page').kind = 'list'

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].kind: "list" is not the kind its name ends with ("page")',
      'contract/domain/screens/sample/$key.yaml:1: anchors["app-shell.extra-button"]: does not start with its screen\'s id "sample"',
    ])
  })
  it('wants every screen id once', () => {
    const contract = sampleContract()

    screenIn(contract, 'app-shell').id = 'sample'

    expect(printed(contract)).toContain(
      'contract/domain/screens/sample/$key.yaml:1: id: "sample" is the id of another screen',
    )
  })
  it('takes an entry derived anchor only through a suffix its base lists in derived', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').entry = [
      'sample.page',
      'sample.mode-select.option',
      'sample.save-button.confirm-button',
    ]

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: entry[2]: "sample.save-button.confirm-button" is not declared on this screen',
    ])
  })
})
