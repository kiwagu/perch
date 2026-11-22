import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { FieldFactsProvider } from '@workspace/ui/field-facts'

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

/** A password the app holds, with a button that empties it as a flow does once an action took it. */
function Held() {
  const [value, setValue] = useState('')

  return (
    <>
      <PasswordInput
        testId="x.y.password-input"
        showLabel="Show"
        hideLabel="Hide"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="button" data-testid="x.y.clear" onClick={() => setValue('')}>
        Clear
      </button>
      <button type="button" data-testid="x.y.preset" onClick={() => setValue('Preset-1')}>
        Preset
      </button>
    </>
  )
}

describe('a PasswordInput whose value the app holds', () => {
  it('stays shown while the person types and deletes, even down to nothing', async () => {
    render(<Held />)

    await userEvent.click(eye())
    await userEvent.type(input(), 'Secret-ann1')
    await userEvent.clear(input())
    await userEvent.type(input(), 'Next-1')

    expect(input().type).toBe('text')
    expect(eye().getAttribute('data-value')).toBe('hide')
  })

  it('hides again once the app empties it, so the next entry is masked until the eye is pressed', async () => {
    render(<Held />)

    await userEvent.type(input(), 'Secret-ann1')
    await userEvent.click(eye())
    expect(input().type).toBe('text')

    await userEvent.click(screen.getByTestId('x.y.clear'))

    expect(input().value).toBe('')
    expect(input().type).toBe('password')
    expect(eye().getAttribute('data-value')).toBe('show')
    expect(eye().getAttribute('aria-pressed')).toBe('false')

    await userEvent.type(input(), 'Next-1')

    expect(input().type).toBe('password')
  })

  it('hides again once the app gives it a value the person did not type', async () => {
    render(<Held />)

    await userEvent.click(eye())
    await userEvent.click(screen.getByTestId('x.y.preset'))

    expect(input().value).toBe('Preset-1')
    expect(input().type).toBe('password')
  })
})

describe('a PasswordInput inside a provider of facts', () => {
  it('takes the limit of its anchor and keeps its own type, shown or hidden', async () => {
    render(
      <FieldFactsProvider
        facts={{ 'x.y.password-input': { maxLength: 35, type: 'email', marksState: false } }}
      >
        <PasswordInput
          testId="x.y.password-input"
          showLabel="Show"
          hideLabel="Hide"
          defaultValue=""
        />
      </FieldFactsProvider>,
    )

    expect(input().maxLength).toBe(35)
    expect(input().type).toBe('password')
    expect(input().className).not.toContain('border-warning')

    await userEvent.click(eye())
    expect(input().type).toBe('text')
  })
})
