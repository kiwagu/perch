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
      'contract/screens.json:1: screens[1].anchors["sample.page"]: also declared on screen "app-shell"',
      'contract/screens.json:1: screens[0].anchors["sample.page"]: does not start with its screen\'s id "app-shell"',
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
      'contract/screens.json:1: screens[1].anchors["sample.list.item"]: reads as the anchor "sample.list" with the suffix "item"; a declared anchor is never named like a derived one',
      'contract/screens.json:1: screens[1].anchors["sample.mode-select.option"]: reads as the anchor "sample.mode-select" with the suffix "option"; a declared anchor is never named like a derived one',
      'contract/screens.json:1: screens[1].anchors["sample.page.pane-button"]: reads as the anchor "sample.page" with the suffix "pane-button"; a declared anchor is never named like a derived one',
    ])
  })
  it('wants every entry anchor declared on its screen', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').entry = ['sample.page', 'app-shell.status', 'sample.gone-page']

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: screens[1].entry[1]: "app-shell.status" is not declared on this screen',
      'contract/screens.json:1: screens[1].entry[2]: "sample.gone-page" is not declared on this screen',
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
      'contract/screens.json:1: screens[1].bindings: a screen that is not the frame needs at least one binding',
    ])
  })
  it('wants every anchor to start with its screen id and end with its kind', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.anchors['app-shell.extra-button'] = { kind: 'button' }
    anchorIn(contract, 'sample.page').kind = 'list'

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: screens[1].anchors["sample.page"].kind: "list" is not the kind its name ends with ("page")',
      'contract/screens.json:1: screens[1].anchors["app-shell.extra-button"]: does not start with its screen\'s id "sample"',
    ])
  })
  it('wants every screen id once', () => {
    const contract = sampleContract()

    screenIn(contract, 'app-shell').id = 'sample'

    expect(printed(contract)).toContain(
      'contract/screens.json:1: screens[1].id: "sample" is the id of another screen',
    )
  })
})
