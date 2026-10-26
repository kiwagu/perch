import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

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
