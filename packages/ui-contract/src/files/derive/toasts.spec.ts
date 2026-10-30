import { describe, expect, it } from 'vitest'

import { toastCodesOf, withToastCodes } from './toasts'

const TOAST = 'app-shell.toast'
const show = (anchor: string, codes: string[]) => ({ type: 'show', params: { anchor, codes } })

describe('toastCodesOf', () => {
  it('gathers every code shown on the anchor, in the order of the flows, each once', () => {
    const first = {
      states: { a: { invoke: { onDone: { actions: [show(TOAST, ['note-created'])] } } } },
    }
    const second = {
      states: {
        b: {
          entry: [show(TOAST, ['slow-network'])],
          on: { x: { actions: [show(TOAST, ['note-created'])] } },
        },
        c: { entry: [show('app-shell.notice-message', ['welcome'])] },
      },
    }

    expect(toastCodesOf([first, undefined, second], TOAST)).toEqual([
      'note-created',
      'slow-network',
    ])
  })
})

describe('withToastCodes', () => {
  const frame = (toast: Record<string, unknown>) => ({
    id: 'app-shell',
    anchors: { [TOAST]: toast, 'app-shell.status': { kind: 'status' } },
  })

  it('gives the anchor the codes when the frame writes none', () => {
    expect(withToastCodes(frame({ kind: 'toast' }), TOAST, ['note-created'])).toEqual(
      frame({ kind: 'toast', codes: ['note-created'] }),
    )
  })

  it('keeps written codes, and leaves an anchor no flow shows anything on without codes', () => {
    expect(
      withToastCodes(frame({ kind: 'toast', codes: ['saved'] }), TOAST, ['note-created']),
    ).toEqual(frame({ kind: 'toast', codes: ['saved'] }))
    expect(withToastCodes(frame({ kind: 'toast' }), TOAST, [])).toEqual(frame({ kind: 'toast' }))
  })
})
