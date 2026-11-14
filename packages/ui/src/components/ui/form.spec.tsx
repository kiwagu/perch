import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'
import { UnsavedInputScope, useMarksState, useUnsavedInput } from '@workspace/ui/unsaved-input'

function Probe() {
  return <output data-testid="probe">{String(useUnsavedInput())}</output>
}

const probe = () => screen.getByTestId('probe').textContent

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('Form', () => {
  it("marks its own fields clean once a submit saved, and no other form's", async () => {
    const user = userEvent.setup()

    render(
      <UnsavedInputScope>
        <Form aria-label="one" onSubmit={() => Promise.resolve(true)}>
          <Input aria-label="first" defaultValue="" />
          <button type="submit">save one</button>
        </Form>
        <Form aria-label="two" onSubmit={() => Promise.resolve(true)}>
          <Input aria-label="second" defaultValue="" />
          <button type="submit">save two</button>
        </Form>
        <Probe />
      </UnsavedInputScope>,
    )

    await user.type(screen.getByLabelText('first'), 'a')
    await user.type(screen.getByLabelText('second'), 'b')
    expect(probe()).toBe('true')

    await user.click(screen.getByText('save one'))
    await waitFor(() => expect(probe()).toBe('true'))

    await user.click(screen.getByText('save two'))
    await waitFor(() => expect(probe()).toBe('false'))
  })

  it('marks clean only what the save took: a field typed into meanwhile, or added since, stays unsaved', async () => {
    const user = userEvent.setup()
    const settles: Array<(saved: boolean) => void> = []
    const submit = () =>
      new Promise<boolean>((settle) => {
        settles.push(settle)
      })
    const page = (more: boolean) => (
      <UnsavedInputScope>
        <Form onSubmit={submit}>
          <Input aria-label="first" defaultValue="" />
          {more ? <Input aria-label="second" defaultValue="" /> : null}
          <button type="submit">save</button>
        </Form>
        <Probe />
      </UnsavedInputScope>
    )
    const { rerender } = render(page(false))

    await user.type(screen.getByLabelText('first'), 'a')
    await user.click(screen.getByText('save'))
    await user.type(screen.getByLabelText('first'), 'b')
    rerender(page(true))
    await user.type(screen.getByLabelText('second'), 'c')
    await act(async () => settles[0]?.(true))
    expect(probe()).toBe('true')

    await user.clear(screen.getByLabelText('second'))
    expect(probe()).toBe('true')
    await user.type(screen.getByLabelText('first'), '{backspace}')
    expect(probe()).toBe('false')
  })

  it('keeps its fields unsaved when the submit did not save', async () => {
    const user = userEvent.setup()

    render(
      <UnsavedInputScope>
        <Form onSubmit={() => Promise.resolve(false)}>
          <Input aria-label="first" defaultValue="" />
          <button type="submit">save</button>
        </Form>
        <Probe />
      </UnsavedInputScope>,
    )

    await user.type(screen.getByLabelText('first'), 'a')
    await user.click(screen.getByText('save'))
    await waitFor(() => expect(probe()).toBe('true'))
  })
})

/** Shows whether a field with its own `own` marks its state. */
function Marks(props: { readonly own?: boolean | undefined }) {
  return <output data-testid="marks">{String(useMarksState(props.own))}</output>
}

const marks = () => screen.getByTestId('marks').textContent

describe('Form marksState', () => {
  it("defaults to true, a form's false reaches its fields, a field's own value wins", () => {
    const { rerender } = render(
      <Form onSubmit={() => true}>
        <Marks />
      </Form>,
    )

    expect(marks()).toBe('true')

    rerender(
      <Form onSubmit={() => true} marksState={false}>
        <Marks />
      </Form>,
    )
    expect(marks()).toBe('false')

    rerender(
      <Form onSubmit={() => true} marksState={false}>
        <Marks own />
      </Form>,
    )
    expect(marks()).toBe('true')

    rerender(
      <Form onSubmit={() => true}>
        <Marks own={false} />
      </Form>,
    )
    expect(marks()).toBe('false')
  })

  it('is true outside a form unless the field says otherwise', () => {
    const { rerender } = render(<Marks />)

    expect(marks()).toBe('true')
    rerender(<Marks own={false} />)
    expect(marks()).toBe('false')
  })
})
