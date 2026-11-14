import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type UnsavedFields,
  UnsavedInputScope,
  useUnsavedFields,
  useUnsavedInput,
  useUnsavedInputChannel,
} from '.'

const FIELD = Symbol('field')

/** Reports `unsaved` for one field while mounted. */
function Reporter(props: { readonly unsaved: boolean }) {
  const channel = useUnsavedInputChannel()

  useEffect(() => {
    channel?.report(FIELD, props.unsaved, undefined)
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

/** Reports `unsaved` for `field`, named `anchor`, while mounted. */
function Named(props: {
  readonly field: symbol
  readonly anchor: string | undefined
  readonly unsaved: boolean
}) {
  const channel = useUnsavedInputChannel()

  useEffect(() => {
    channel?.report(props.field, props.unsaved, props.anchor)
  }, [channel, props.field, props.unsaved, props.anchor])
  useEffect(() => () => channel?.forget(props.field), [channel, props.field])

  return null
}

let reader: (() => UnsavedFields) | undefined

/** Keeps the scope's reader, to read it when a test asks, as a guard reads it. */
function Reader() {
  reader = useUnsavedFields()

  return null
}

/** What the reader gives now: the anchors in order, and whether a field reported none. */
const fieldsNow = () => {
  const fields = reader?.()

  return fields === undefined
    ? undefined
    : { anchors: [...fields.anchors].sort(), unnamed: fields.unnamed }
}

const NAMED_A = Symbol('a')
const NAMED_B = Symbol('b')
const UNNAMED = Symbol('unnamed')

describe('useUnsavedFields', () => {
  it('reads the anchors of the fields that hold unsaved input, and whether one reported none', () => {
    render(
      <UnsavedInputScope>
        <Named field={NAMED_A} anchor="x.a-input" unsaved />
        <Named field={NAMED_B} anchor="x.b-input" unsaved={false} />
        <Named field={UNNAMED} anchor={undefined} unsaved />
        <Reader />
      </UnsavedInputScope>,
    )

    expect(fieldsNow()).toEqual({ anchors: ['x.a-input'], unnamed: true })
  })

  it('keeps an anchor while another field that shares it still holds unsaved input', () => {
    const { rerender } = render(
      <UnsavedInputScope>
        <Named key="a" field={NAMED_A} anchor="x.a-input" unsaved />
        <Named key="b" field={NAMED_B} anchor="x.a-input" unsaved />
        <Reader />
      </UnsavedInputScope>,
    )

    // B stays mounted and reports nothing again: only A leaves.
    act(() => {
      rerender(
        <UnsavedInputScope>
          <Named key="b" field={NAMED_B} anchor="x.a-input" unsaved />
          <Reader />
        </UnsavedInputScope>,
      )
    })

    expect(fieldsNow()).toEqual({ anchors: ['x.a-input'], unnamed: false })
  })

  it('follows a field whose anchor changes, and one that stops naming any, through one reader', () => {
    const scoped = (anchor: string | undefined) => (
      <UnsavedInputScope>
        <Named field={NAMED_A} anchor={anchor} unsaved />
        <Reader />
      </UnsavedInputScope>
    )
    const { rerender } = render(scoped('x.a-input'))
    const first = reader
    const now = () => {
      const fields = first?.()

      return { anchors: [...(fields?.anchors ?? [])], unnamed: fields?.unnamed }
    }

    expect(now()).toEqual({ anchors: ['x.a-input'], unnamed: false })

    rerender(scoped('x.b-input'))
    expect(now()).toEqual({ anchors: ['x.b-input'], unnamed: false })

    rerender(scoped(undefined))
    expect(now()).toEqual({ anchors: [], unnamed: true })

    rerender(scoped('x.a-input'))
    expect(now()).toEqual({ anchors: ['x.a-input'], unnamed: false })
  })

  it('reads a field once under StrictMode, whose effects run twice', () => {
    render(
      <StrictMode>
        <UnsavedInputScope>
          <Named field={NAMED_A} anchor="x.a-input" unsaved />
          <Reader />
        </UnsavedInputScope>
      </StrictMode>,
    )

    expect(fieldsNow()).toEqual({ anchors: ['x.a-input'], unnamed: false })
  })

  it('reads no field outside a scope', () => {
    render(<Reader />)

    expect(fieldsNow()).toEqual({ anchors: [], unnamed: false })
  })
})
