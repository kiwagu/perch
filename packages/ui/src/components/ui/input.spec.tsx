import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense, startTransition, use, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from '@workspace/ui/components/ui/input'
import { Textarea } from '@workspace/ui/components/ui/textarea'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

function Probe() {
  return <output data-testid="probe">{String(useUnsavedInput())}</output>
}

/** A controlled input as the app renders one: it echoes what is typed, and `given` is what the app sets. */
function Controlled(props: { readonly given: string; readonly holdsInput?: boolean }) {
  const [value, setValue] = useState(props.given)
  const [given, setGiven] = useState(props.given)

  if (given !== props.given) {
    setGiven(props.given)
    setValue(props.given)
  }

  return (
    <Input
      aria-label="name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      holdsInput={props.holdsInput}
    />
  )
}

const probe = () => screen.getByTestId('probe').textContent

/** A promise that never settles: whatever reads it stays suspended. */
const NEVER = new Promise<never>(() => {})

/** Suspends while `on`, so a transition that turns it on never commits. */
function Stall(props: { readonly on: boolean }) {
  if (props.on) {
    use(NEVER)
  }

  return null
}

/** A controlled input whose "later" button renders a new value in a transition that never commits. */
function Abandoned() {
  const [value, setValue] = useState('Ann')
  const [stalled, setStalled] = useState(false)

  return (
    <>
      <Input aria-label="name" value={value} onChange={(event) => setValue(event.target.value)} />
      <button
        type="button"
        onClick={() =>
          startTransition(() => {
            setValue('Cy')
            setStalled(true)
          })
        }
      >
        later
      </button>
      <Suspense fallback={null}>
        <Stall on={stalled} />
      </Suspense>
    </>
  )
}

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('Input', () => {
  it('holds unsaved input while its value differs from the last value the app gave it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <UnsavedInputScope>
        <Controlled given="Ann" />
        <Probe />
      </UnsavedInputScope>,
    )
    const field = screen.getByLabelText('name')

    expect(probe()).toBe('false')
    await user.type(field, 'e')
    expect(probe()).toBe('true')
    await user.type(field, '{backspace}')
    expect(probe()).toBe('false')
    await user.type(field, 'a')
    expect(probe()).toBe('true')

    rerender(
      <UnsavedInputScope>
        <Controlled given="Bob" />
        <Probe />
      </UnsavedInputScope>,
    )
    expect(probe()).toBe('false')
  })

  it('takes no value from a render that never committed', async () => {
    const user = userEvent.setup()

    render(
      <UnsavedInputScope>
        <Abandoned />
        <Probe />
      </UnsavedInputScope>,
    )

    await user.click(screen.getByText('later'))
    await user.clear(screen.getByLabelText('name'))
    await user.type(screen.getByLabelText('name'), 'Cy')
    expect(probe()).toBe('true')
  })

  it('tracks an uncontrolled field from its default value', async () => {
    const user = userEvent.setup()

    render(
      <UnsavedInputScope>
        <Input aria-label="name" defaultValue="Ann" />
        <Probe />
      </UnsavedInputScope>,
    )
    const field = screen.getByLabelText('name')

    await user.type(field, 'e')
    expect(probe()).toBe('true')
    await user.type(field, '{backspace}')
    expect(probe()).toBe('false')
  })

  it('never holds unsaved input when holdsInput is false, and reports nowhere outside a scope', async () => {
    const user = userEvent.setup()

    render(
      <UnsavedInputScope>
        <Controlled given="Ann" holdsInput={false} />
        <Probe />
      </UnsavedInputScope>,
    )
    await user.type(screen.getByLabelText('name'), 'e')
    expect(probe()).toBe('false')

    cleanup()
    render(<Input aria-label="alone" defaultValue="" />)
    await user.type(screen.getByLabelText('alone'), 'x')
    expect(screen.getByLabelText('alone')).toHaveProperty('value', 'x')
  })
})

describe('Textarea', () => {
  it('holds unsaved input while its text differs from the text it was given', async () => {
    const user = userEvent.setup()

    render(
      <UnsavedInputScope>
        <Textarea aria-label="bio" defaultValue="" />
        <Probe />
      </UnsavedInputScope>,
    )

    await user.type(screen.getByLabelText('bio'), 'x')
    expect(probe()).toBe('true')
    await user.type(screen.getByLabelText('bio'), '{backspace}')
    expect(probe()).toBe('false')
  })
})
