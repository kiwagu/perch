import { describe, expect, it } from 'vitest'

import { type FlowTransition, formatProblem } from '../../files'
import { parallelIn, regionStateIn, withAreas } from '../areas.fixture'
import type { Contract } from '../contract'
import { flowIn, flowStateIn, sampleContract } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'

const ONLY_ON_ERROR = "it guards only a branch of an invoke's onError"

const FAILED: FlowTransition = {
  target: 'editing',
  actions: [{ type: 'show', params: { anchor: 'sample.save-button', codes: ['failed'] } }],
}

/**
 * The sample contract whose `saving` runs `platform.things.share`, which fails with
 * `not-allowed`, `rate-limited` or `failed`, its `onError` a branch guarded by `refused`, a
 * guard by failure code, then the rest.
 */
function sharing(codes: string[] = ['not-allowed']): Contract {
  const contract = sampleContract()
  const saving = flowStateIn(contract, 'saving')

  contract.screens.platform.actions['things.share'] = {
    description: 'Shares the thing.',
    params: {},
    result: 'the thing is shared',
    codes: ['not-allowed', 'rate-limited', 'failed'],
  }
  flowIn(contract).meta = {
    guards: { titleGiven: 'the title input holds a title', refused: { codes } },
  }
  saving.invoke = {
    src: 'platform.things.share',
    onDone: { target: 'editing' },
    onError: [{ ...FAILED, guard: 'refused' }, FAILED],
  }

  return contract
}

describe('flowProblems and the guards by failure code', () => {
  it('takes one on a branch of an onError, naming codes its action fails with', () => {
    expect(printed(sharing(['not-allowed', 'rate-limited']))).toEqual([])
  })
  it('takes one on the onError of a state of a region, and alone on an onError', () => {
    const contract = withAreas()
    const busy = regionStateIn(contract, 'side', 'busy')

    flowIn(contract).meta = {
      guards: { titleGiven: 'the title input holds a title', broke: { codes: ['failed'] } },
    }

    if (busy.invoke === undefined) {
      throw new Error('the side area creates a thing through an invoke')
    }

    busy.invoke.onError = { ...FAILED, target: 'idle', guard: 'broke' }

    expect(printed(contract)).toEqual([])
  })
  it('wants each code one the action fails with', () => {
    expect(printed(sharing(['not-allowed', 'gone', 'lost']))).toEqual([
      `${AT}.states.saving.invoke.onError[0].guard: "refused" names "gone", "lost", which platform.things.share does not fail with`,
    ])
  })
  it('wants each code listed once', () => {
    expect(printed(sharing(['not-allowed', 'failed', 'not-allowed']))).toEqual([
      `${AT}.meta.guards.refused.codes[2]: "not-allowed" is already listed`,
    ])
  })
  it('refuses one on a transition of an event or an onDone: no failure is there to tell apart', () => {
    const contract = sharing()
    const editing = flowStateIn(contract, 'editing')
    const { invoke } = flowStateIn(contract, 'saving')

    editing.on = {
      'sample.save-button': [
        { guard: 'refused', target: 'saving' },
        { guard: 'titleGiven', target: 'saving' },
        FAILED,
      ],
    }

    if (invoke === undefined) {
      throw new Error('saving shares through an invoke')
    }

    invoke.onDone = [{ guard: 'refused', target: 'editing' }, { target: 'editing' }]

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"][0].guard: "refused" is a guard by failure code: ${ONLY_ON_ERROR}`,
      `${AT}.states.saving.invoke.onDone[0].guard: "refused" is a guard by failure code: ${ONLY_ON_ERROR}`,
    ])
  })
  it("refuses one on a parallel state's own event and on an event of a state of a region", () => {
    const contract = withAreas()

    flowIn(contract).meta = {
      guards: { titleGiven: 'the title input holds a title', broke: { codes: ['failed'] } },
    }
    parallelIn(contract).on = {
      'sample.save-button': [{ guard: 'broke', target: 'saving' }, { target: 'saving' }],
    }
    regionStateIn(contract, 'form', 'closed').on = {
      'sample.a-button': [{ guard: 'titleGiven', target: 'open' }, { target: 'open' }],
    }

    const busy = regionStateIn(contract, 'side', 'idle')

    busy.on = { 'sample.b-button': { target: 'busy', guard: 'broke' } }

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.save-button"][0].guard: "broke" is a guard by failure code: ${ONLY_ON_ERROR}`,
      `${AT}.states.editing.states.side.states.idle.on["sample.b-button"].guard: "broke" is a guard by failure code: ${ONLY_ON_ERROR}`,
    ])
  })
  it('leaves an action that does not exist to the check of the invoke', () => {
    const contract = sharing(['gone'])
    const { invoke } = flowStateIn(contract, 'saving')

    if (invoke === undefined) {
      throw new Error('saving shares through an invoke')
    }

    invoke.src = 'platform.things.lost'

    expect(printed(contract)).toEqual([
      `${AT}.states.saving.invoke.src: no platform action "things.lost"`,
    ])
  })
})
