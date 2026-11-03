import { describe, expect, it } from 'vitest'

import { formatProblem } from '../../files'
import { parallelIn, regionStateIn, withAreas } from '../areas.fixture'
import type { Contract } from '../contract'
import { flowIn, flowStateIn, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'

const IN = `${AT}.states.editing.states`

const ONLY_LISTED = 'only the states that list it in meta.renders render it'

/** The sample contract with a button declared under its list, `sample.list.add-button`. */
function withNested(): Contract {
  const contract = sampleContract()

  screenIn(contract, 'sample').anchors['sample.list.add-button'] = { kind: 'button' }

  return contract
}

describe('flowProblems and the anchors a state renders', () => {
  it('takes anchors of the screen, each rendered by the states that handle it', () => {
    const contract = sampleContract()
    const editing = flowStateIn(contract, 'editing')

    editing.meta = { renders: ['sample.save-button', 'sample.mode-select'] }
    Object.assign(editing.on ?? {}, { 'sample.mode-select.option': { target: 'saving' } })
    flowStateIn(contract, 'saving').meta = { renders: ['sample.save-button', 'sample.list'] }

    expect(printed(contract)).toEqual([])
  })
  it("wants each name an anchor the screen declares, a part's base instead of the part, once", () => {
    const contract = sampleContract()

    flowStateIn(contract, 'saving').meta = {
      renders: [
        'sample.list',
        'sample.gone-button',
        'app-shell.status',
        'sample.mode-select.option',
        'sample.list',
      ],
    }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.meta.renders[1]: "sample.gone-button" is not a declared anchor of the screen`,
      `${AT}.states.saving.meta.renders[2]: "app-shell.status" is not a declared anchor of the screen`,
      `${AT}.states.saving.meta.renders[3]: "sample.mode-select.option" is a part derived from "sample.mode-select": a state lists the base, which renders its parts`,
      `${AT}.states.saving.meta.renders[4]: "sample.list" is already listed`,
    ])
  })
  it('wants a state that handles an anchor some state lists to render it, a part through its base', () => {
    const contract = sampleContract()
    const editing = flowStateIn(contract, 'editing')

    Object.assign(editing.on ?? {}, { 'sample.mode-select.option': { target: 'saving' } })
    flowStateIn(contract, 'saving').meta = {
      renders: ['sample.save-button', 'sample.mode-select'],
    }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"]: "sample.save-button" is handled here but not rendered: ${ONLY_LISTED}`,
      `${AT}.states.editing.on["sample.mode-select.option"]: "sample.mode-select.option" is handled here but not rendered: only the states that list "sample.mode-select" in meta.renders render it`,
    ])
  })
  it('leaves an anchor no state lists, or a name the screen does not declare, to every state', () => {
    const contract = sampleContract()

    flowStateIn(contract, 'saving').meta = { renders: ['sample.list', 'sample.gone-button'] }
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.gone-button': { target: 'saving' },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.gone-button"]: "sample.gone-button" is not a declared anchor`,
      `${AT}.states.saving.meta.renders[1]: "sample.gone-button" is not a declared anchor of the screen`,
    ])
  })
})

describe('flowProblems and the anchors a parallel state and its regions render', () => {
  it('renders in a state of a region what it lists and what its parallel state lists', () => {
    const contract = withAreas()

    parallelIn(contract).meta = { renders: ['sample.a-button'] }
    regionStateIn(contract, 'side', 'idle').meta = { renders: ['sample.b-button'] }

    expect(printed(contract)).toEqual([])
  })
  it('wants a state of a region that handles an anchor another state lists to render it', () => {
    const contract = withAreas()

    regionStateIn(contract, 'form', 'open').meta = { renders: ['sample.a-button'] }

    expect(printed(contract)).toEqual([
      `${IN}.form.states.closed.on["sample.a-button"]: "sample.a-button" is handled here but not rendered: ${ONLY_LISTED}`,
    ])
  })
  it('holds the lists of a parallel state and of a state of a region to the anchors of the screen', () => {
    const contract = withAreas()

    parallelIn(contract).meta = { renders: ['sample.save-button.confirm-button'] }
    regionStateIn(contract, 'form', 'open').meta = {
      renders: ['sample.list', 'sample.list'],
    }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.meta.renders[0]: "sample.save-button.confirm-button" is not a declared anchor of the screen`,
      `${IN}.form.states.open.meta.renders[1]: "sample.list" is already listed`,
    ])
  })
})

describe('flowProblems and the anchors nested under a listed one', () => {
  it('renders the anchors nested under a listed anchor with it', () => {
    const contract = withNested()
    const editing = flowStateIn(contract, 'editing')

    editing.meta = { renders: ['sample.list'] }
    Object.assign(editing.on ?? {}, { 'sample.list.add-button': { target: 'saving' } })

    expect(printed(contract)).toEqual([])
  })
  it('makes a nested anchor rendered only where its container is', () => {
    const contract = withNested()

    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.list.add-button': { target: 'saving' },
    })
    flowStateIn(contract, 'saving').meta = { renders: ['sample.list'] }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.list.add-button"]: "sample.list.add-button" is handled here but not rendered: only the states that list "sample.list" in meta.renders render it`,
    ])
  })
  it('renders a nested anchor where it is listed itself, too', () => {
    const contract = withNested()
    const editing = flowStateIn(contract, 'editing')

    editing.meta = { renders: ['sample.list.add-button'] }
    Object.assign(editing.on ?? {}, {
      'sample.list.add-button': { target: 'saving' },
      'sample.a-button': { target: 'viewing' },
    })
    flowStateIn(contract, 'saving').meta = { renders: ['sample.list'] }
    flowIn(contract).states['viewing'] = {
      on: { 'sample.list.add-button': { target: 'editing' } },
    }

    expect(printed(contract)).toEqual([
      `${AT}.states.viewing.on["sample.list.add-button"]: "sample.list.add-button" is handled here but not rendered: only the states that list "sample.list" or "sample.list.add-button" in meta.renders render it`,
    ])
  })
  it('refuses a container and an anchor nested under it in one list, not in two', () => {
    const contract = withNested()

    flowStateIn(contract, 'editing').meta = { renders: ['sample.list.add-button', 'sample.list'] }
    flowStateIn(contract, 'saving').meta = { renders: ['sample.list'] }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.meta.renders[0]: "sample.list.add-button" is nested under "sample.list", listed here too, which renders it already`,
    ])

    const areas = withAreas()

    screenIn(areas, 'sample').anchors['sample.list.add-button'] = { kind: 'button' }
    parallelIn(areas).meta = { renders: ['sample.list'] }
    regionStateIn(areas, 'form', 'open').meta = { renders: ['sample.list.add-button'] }

    expect(printed(areas)).toEqual([])
  })
})
