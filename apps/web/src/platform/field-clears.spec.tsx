// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createActor, emit, setup } from 'xstate'

import { useFieldClears } from './field-clears'

/** A machine that clears a field, then the frame's notice, on each event. */
const machine = setup({
  types: {
    events: {} as { readonly type: 'x.save-button' },
    emitted: {} as { readonly type: 'clear'; readonly anchor: string },
  },
}).createMachine({
  on: {
    'x.save-button': {
      actions: [
        emit({ type: 'clear', anchor: 'x.form.name-input' }),
        emit({ type: 'clear', anchor: 'app-shell.notice-message' }),
      ],
    },
  },
})

describe('useFieldClears', () => {
  it('empties the field a clear names, and leaves an anchor it does not name to its channel', () => {
    const actor = createActor(machine).start()
    const name = vi.fn()
    const { unmount } = renderHook(() => useFieldClears(actor, { 'x.form.name-input': name }))

    act(() => actor.send({ type: 'x.save-button' }))

    expect(name).toHaveBeenCalledTimes(1)

    unmount()
    actor.send({ type: 'x.save-button' })

    expect(name).toHaveBeenCalledTimes(1)
  })
})
