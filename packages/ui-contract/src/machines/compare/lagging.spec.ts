import { describe, expect, it } from 'vitest'

import { laggingOf } from './lagging'
import { projected } from './projection'

/** A flow whose save goes where `after` says once it succeeds. */
const flow = (after: string) =>
  projected({
    initial: 'editing',
    states: {
      editing: { on: { 'sample.save-button': { target: 'saving' } } },
      saving: { invoke: { src: 'sample.save', onDone: { target: after } } },
      done: { type: 'final' },
      checking: { on: { 'sample.save-button': { target: 'saving' } } },
    },
  })

/** A business commit changed where a successful save leads: `done` at the base, `checking` now. */
const BASE = flow('done')
const NOW = flow('checking')

describe('laggingOf', () => {
  it('holds a machine that is still its flow at the base to that flow', () => {
    expect(laggingOf(BASE, NOW, BASE)).toEqual(BASE)
  })
  it('holds a machine that left the base to the flow now, less what it has not built', () => {
    expect(laggingOf(NOW, NOW, BASE)).toEqual(NOW)
  })
  it('gives a machine that is neither something it does not equal', () => {
    const elsewhere = flow('editing')

    expect(laggingOf(elsewhere, NOW, BASE)).not.toEqual(elsewhere)
  })
  it('without a base, holds even the base machine to the flow now', () => {
    expect(laggingOf(BASE, NOW, undefined)).not.toEqual(BASE)
  })
})
