import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { PasswordInput } from '@workspace/ui/components/platform/password-input'

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

const input = () => screen.getByTestId('x.y.password-input') as HTMLInputElement
const eye = () => screen.getByTestId('x.y.password-input.visibility-button')

describe('PasswordInput', () => {
  it('hides what it holds at first, its eye offering to show it', () => {
    render(<PasswordInput testId="x.y.password-input" showLabel="Show" hideLabel="Hide" value="" />)

    expect(input().type).toBe('password')
    expect(eye().getAttribute('data-value')).toBe('show')
    expect(eye().getAttribute('aria-label')).toBe('Show')
    expect(eye().getAttribute('aria-pressed')).toBe('false')
  })

  it('shows what it holds as typed on a click of the eye, and hides it again on the next', async () => {
    render(
      <PasswordInput
        testId="x.y.password-input"
        showLabel="Show"
        hideLabel="Hide"
        defaultValue=""
      />,
    )

    await userEvent.type(input(), 'Secret-ann1')
    await userEvent.click(eye())

    expect(input().type).toBe('text')
    expect(input().value).toBe('Secret-ann1')
    expect(eye().getAttribute('data-value')).toBe('hide')
    expect(eye().getAttribute('aria-label')).toBe('Hide')

    await userEvent.click(eye())

    expect(input().type).toBe('password')
    expect(eye().getAttribute('data-value')).toBe('show')
  })

  it('keeps the eye enabled while the input is disabled, and outside the form it sits in', () => {
    render(
      <form onSubmit={() => expect.unreachable('the eye submits nothing')}>
        <PasswordInput
          testId="x.y.password-input"
          showLabel="Show"
          hideLabel="Hide"
          value=""
          disabled
        />
      </form>,
    )

    expect(input().disabled).toBe(true)
    expect((eye() as HTMLButtonElement).disabled).toBe(false)
    expect((eye() as HTMLButtonElement).type).toBe('button')
  })
})
