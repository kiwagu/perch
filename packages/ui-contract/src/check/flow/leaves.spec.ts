import { describe, expect, it } from 'vitest'

import { type Effect, formatProblem } from '../../files'
import type { Contract } from '../contract'
import { flowStateIn, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'
const FRAME_AT = 'contract/domain/screens/__root.yaml:1: flow'
const LINK = 'sample.help-link'
const TITLE = 'sample.title-input'
const ON_LINK = `${AT}.states.editing.on["${LINK}"]`

const navigate = (to: string, search?: Record<string, unknown>): Effect =>
  ({ type: 'navigate', params: search === undefined ? { to } : { to, search } }) as Effect

/** The sample with a help link and its title holding input, beside a help screen at `/help`. */
function sample(): Contract {
  const contract = sampleContract()
  const screen = screenIn(contract, 'sample')

  contract.screens.screens.push({
    id: 'help',
    title: 'Help',
    description: 'Where a member reads how the sample works.',
    flag: null,
    bindings: [
      {
        path: '/help',
        roles: ['member'],
        history: 'push',
        search: {
          type: 'object',
          properties: { title: { type: 'string' } },
          additionalProperties: false,
        },
      },
    ],
    entry: ['help.page'],
    anchors: { 'help.page': { kind: 'page' } },
  })

  screen.anchors = {
    ...screen.anchors,
    [LINK]: { kind: 'link' },
    [TITLE]: { ...screen.anchors[TITLE], kind: 'input', holdsInput: true },
  }

  return contract
}

/** `sample()` whose `state` handles the help link with `transitions`. */
function handling(contract: Contract, state: string, transitions: unknown): Contract {
  Object.assign(flowStateIn(contract, state).on ?? {}, { [LINK]: transitions })

  return contract
}

describe('a navigate is a leave its trigger names', () => {
  it('passes a control that leaves its screen the same way in every state that handles it', () => {
    const contract = handling(sample(), 'editing', { actions: [navigate('/help')] })

    flowStateIn(contract, 'saving').on = { [LINK]: { actions: [navigate('/help')] } }

    expect(printed(contract)).toEqual([])
  })

  it('refuses a navigate in an entry or an exit, where no control could ask before it', () => {
    const contract = sample()

    flowStateIn(contract, 'editing').entry = [navigate('/help')]
    flowStateIn(contract, 'editing').exit = [navigate('/help')]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0]: a navigate sits on a transition, whose trigger says which leave it is: in an entry no control could ask before it`,
      `${AT}.states.editing.exit[0]: a navigate sits on a transition, whose trigger says which leave it is: in an exit no control could ask before it`,
    ])
  })

  it('refuses a second navigate on one transition', () => {
    const contract = handling(sample(), 'editing', {
      actions: [navigate('/help'), navigate('/help')],
    })

    expect(printed(contract)).toEqual([
      `${ON_LINK}.actions[1]: a transition moves the app once: a second navigate on it is refused`,
    ])
  })

  it('refuses a control that leaves its screen in one branch and stays in another', () => {
    const contract = handling(sample(), 'editing', [
      { guard: 'titleGiven', actions: [navigate('/help')] },
      { target: 'editing' },
    ])

    expect(printed(contract)).toEqual([
      `${ON_LINK}[1]: "${LINK}" leaves its screen at flow.states.editing.on["${LINK}"][0] and not here: its question is asked before its event, so it cannot depend on the state or a guard`,
    ])
  })

  it('refuses a control that leaves its screen in one state and stays in another', () => {
    const contract = handling(sample(), 'editing', { actions: [navigate('/help')] })

    flowStateIn(contract, 'saving').on = { [LINK]: { target: 'editing' } }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.on["${LINK}"]: "${LINK}" leaves its screen at flow.states.editing.on["${LINK}"] and not here: its question is asked before its event, so it cannot depend on the state or a guard`,
    ])
  })

  it('refuses a control that loses other fields in another state', () => {
    const contract = handling(sample(), 'editing', { actions: [navigate('/help')] })

    flowStateIn(contract, 'saving').on = {
      [LINK]: { actions: [navigate('/help', { title: { anchor: TITLE } })] },
    }

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.on["${LINK}"]: "${LINK}" loses other fields here than at flow.states.editing.on["${LINK}"]: its question is asked before its event, so it cannot depend on the state or a guard`,
    ])
  })

  it('refuses a move of a control to a path of its own screen when the screen has several', () => {
    const contract = handling(sample(), 'editing', { actions: [navigate('/sample/$key')] })

    screenIn(contract, 'sample').bindings.push({
      path: '/sample',
      roles: ['member'],
      history: 'push',
    })

    expect(printed(contract)).toContain(
      `${ON_LINK}.actions[0]: "/sample/$key" is a path of this screen, which has several: whether the move leaves it depends on the one it is at, which the control's question cannot say`,
    )
  })

  it("refuses a navigate on the event of an anchor of another screen, or of the frame's own control", () => {
    const contract = sample()
    const frame = screenIn(contract, 'app-shell')

    frame.anchors = { ...frame.anchors, 'app-shell.theme-select': { kind: 'select' } }
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'app-shell.theme-select': { actions: [navigate('/help')] },
    })
    frame.flow = {
      initial: 'running',
      states: { running: { on: { 'app-shell.theme-select': { actions: [navigate('/help')] } } } },
    } as never

    expect(printed(contract)).toEqual(
      expect.arrayContaining([
        `${AT}.states.editing.on["app-shell.theme-select"].actions[0]: a navigate on the event of "app-shell.theme-select", which this screen does not declare: a control's leave asks for the fields of its own screen`,
        `${FRAME_AT}.states.running.on["app-shell.theme-select"].actions[0]: a navigate on the event of "app-shell.theme-select" in the frame: the frame has no path, so its control's leave cannot name the fields it loses`,
      ]),
    )
  })

  it('passes a navigate after an action and on a platform event', () => {
    const contract = sample()

    contract.screens.platform.events = { 'signed-out': 'The account was signed out elsewhere.' }
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'platform.signed-out': { actions: [navigate('/help')] },
    })

    expect(printed(contract)).toEqual([])
  })
})
