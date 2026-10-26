import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { UnsavedInputScope, useUnsavedInput, useUnsavedInputChannel } from '.'

const FIELD = Symbol('field')

/** Reports `unsaved` for one field while mounted. */
function Reporter(props: { readonly unsaved: boolean }) {
  const channel = useUnsavedInputChannel()

  useEffect(() => {
    channel?.report(FIELD, props.unsaved)
  }, [channel, props.unsaved])
  useEffect(() => () => channel?.forget(FIELD), [channel])

  return null
}

function Probe() {
  return <output data-testid="probe">{String(useUnsavedInput())}</output>
}

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('UnsavedInputScope', () => {
  it('says whether any field inside holds unsaved input, and forgets a field that leaves', () => {
    const { rerender } = render(
      <UnsavedInputScope>
        <Reporter unsaved={false} />
        <Probe />
      </UnsavedInputScope>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('false')

    rerender(
      <UnsavedInputScope>
        <Reporter unsaved />
        <Probe />
      </UnsavedInputScope>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('true')

    act(() => {
      rerender(
        <UnsavedInputScope>
          <Probe />
        </UnsavedInputScope>,
      )
    })
    expect(screen.getByTestId('probe').textContent).toBe('false')
  })

  it('is false outside a scope, where a field reports nowhere', () => {
    render(
      <>
        <Reporter unsaved />
        <Probe />
      </>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('false')
  })
})
