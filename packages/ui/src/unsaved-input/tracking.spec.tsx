import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { UnsavedInputScope, useTracksInput, useUnsavedInput } from '.'

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('useTracksInput', () => {
  it('keeps a default that is a function as the value, never calling it', () => {
    const defaultValue = () => 'called'
    const { result } = renderHook(
      () => {
        useTracksInput({ holdsInput: true, value: undefined, defaultValue })

        return useUnsavedInput()
      },
      { wrapper: UnsavedInputScope },
    )

    expect(result.current).toBe(false)
  })
})
