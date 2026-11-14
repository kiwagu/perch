import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, Suspense, startTransition, use, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'
import { Textarea } from '@workspace/ui/components/ui/textarea'
import {
  type UnsavedFields,
  UnsavedInputScope,
  useUnsavedFields,
  useUnsavedInput,
} from '@workspace/ui/unsaved-input'

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

let reader: (() => UnsavedFields) | undefined

function Reader() {
  reader = useUnsavedFields()

  return null
}

describe('the anchor a field reports', () => {
  it('is the anchor an input renders, while it holds unsaved input', async () => {
    render(
      <UnsavedInputScope>
        <Input aria-label="name" data-testid="x.name-input" defaultValue="" />
        <Reader />
      </UnsavedInputScope>,
    )

    await userEvent.type(screen.getByLabelText('name'), 'Ann')

    expect([...(reader?.().anchors ?? [])]).toEqual(['x.name-input'])
  })

  it('is the anchor a textarea renders, while it holds unsaved input', async () => {
    render(
      <UnsavedInputScope>
        <Textarea aria-label="bio" data-testid="x.bio-input" defaultValue="" />
        <Reader />
      </UnsavedInputScope>,
    )

    await userEvent.type(screen.getByLabelText('bio'), 'Hi')

    expect([...(reader?.().anchors ?? [])]).toEqual(['x.bio-input'])
  })
})

/** Types into the field, then submits its form so that what it holds is saved. */
async function typeAndSave(label: string, text: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(label), text)
  await userEvent.click(screen.getByText('save'))
}

const STORED = new Set(['x.name-input', 'x.bio-input'])

/** A form whose one field is `children`, in a scope that says the anchors it stores. */
function Saving(props: { readonly children: ReactNode; readonly marksState?: boolean }) {
  return (
    <UnsavedInputScope stores={(anchor) => STORED.has(anchor)}>
      <Form onSubmit={() => true} marksState={props.marksState}>
        {props.children}
        <button type="submit">save</button>
      </Form>
    </UnsavedInputScope>
  )
}

describe.each([
  [
    'Input',
    'x.name-input',
    (marksState?: boolean) => (
      <Input aria-label="f" data-testid="x.name-input" defaultValue="" marksState={marksState} />
    ),
  ],
  [
    'Textarea',
    'x.bio-input',
    (marksState?: boolean) => (
      <Textarea aria-label="f" data-testid="x.bio-input" defaultValue="" marksState={marksState} />
    ),
  ],
])('the state a %s shows on its own border', (_name, _anchor, field) => {
  it('has no state untouched, unsaved once typed, saved once a submit saved it', async () => {
    render(<Saving>{field()}</Saving>)

    const element = screen.getByLabelText('f')

    expect(element.hasAttribute('data-state')).toBe(false)
    await userEvent.type(element, 'x')
    expect(element.getAttribute('data-state')).toBe('unsaved')
    await userEvent.click(screen.getByText('save'))
    expect(element.getAttribute('data-state')).toBe('saved')
  })

  it('colors its border by the state, and loses the colors with marksState={false}, keeping data-state', async () => {
    const { rerender } = render(<Saving>{field()}</Saving>)
    const element = screen.getByLabelText('f')

    expect(element.className).toContain('data-[state=unsaved]:not-aria-invalid:border-warning')
    expect(element.className).toContain('data-[state=saved]:not-aria-invalid:border-success')
    expect(element.className).not.toMatch(/(^| )focus-visible:border-ring/)

    rerender(<Saving>{field(false)}</Saving>)
    await typeAndSave('f', 'x')
    expect(element.className).not.toContain('border-warning')
    expect(element.className).not.toContain('border-success')
    expect(element.className).toMatch(/(^| )focus-visible:border-ring/)
    expect(element.getAttribute('data-state')).toBe('saved')
  })

  it("takes its form's marksState, which its own wins over", () => {
    render(<Saving marksState={false}>{field()}</Saving>)
    expect(screen.getByLabelText('f').className).not.toContain('border-warning')

    cleanup()
    render(<Saving marksState={false}>{field(true)}</Saving>)
    expect(screen.getByLabelText('f').className).toContain('border-warning')
  })
})
