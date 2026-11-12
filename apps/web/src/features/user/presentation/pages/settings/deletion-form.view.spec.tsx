// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'

import { DeletionFormView, type DeletionFormViewProps } from './deletion-form.view'

function renderView(props: Partial<DeletionFormViewProps> = {}) {
  const handlers = { onChange: vi.fn(), onSend: vi.fn(() => Promise.resolve(true)) }

  renderWithProviders(<DeletionFormView password="" canSend {...handlers} {...props} />)

  return handlers
}

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

describe('DeletionFormView', () => {
  it('warns that the link deletes the account for good, with a secret password and its eye', () => {
    renderView()

    expect(screen.getByTestId('user.settings.deletion.form')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Delete the account' })).toBeTruthy()
    expect(screen.getByText(/cannot be undone/)).toBeTruthy()
    expect(input('user.settings.deletion.password-input').type).toBe('password')
    expect(
      screen.getByTestId('user.settings.deletion.password-input.visibility-button'),
    ).toBeTruthy()
    expect(screen.getByTestId('user.settings.deletion.send-button').textContent).toBe(
      'Send the deletion link',
    )
  })

  it('tells each keystroke, and sends', () => {
    const { onChange, onSend } = renderView()

    fireEvent.change(input('user.settings.deletion.password-input'), {
      target: { value: 'Secret-ann1' },
    })
    fireEvent.submit(screen.getByTestId('user.settings.deletion.form'))

    expect(onChange).toHaveBeenCalledWith('Secret-ann1')
    expect(onSend).toHaveBeenCalled()
  })

  it('asks to open the link of the mail, which deletes only on the press of its page', () => {
    renderView({ message: 'check-your-mail' })

    const message = screen.getByTestId('user.settings.deletion.message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain('Nothing changes until')
  })

  it('shows no message and no error before anything was sent', () => {
    renderView()

    expect(screen.queryByTestId('user.settings.deletion.message')).toBeNull()
    expect(screen.queryByTestId('user.settings.deletion.error')).toBeNull()
  })

  it('says a wrong password under the password field', () => {
    renderView({ error: 'data:INVALID_CREDENTIALS' })

    const error = screen.getByTestId('user.settings.deletion.error')
    const field = input('user.settings.deletion.password-input')

    expect(error.getAttribute('data-code')).toBe('invalid-credentials')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.closest('[data-slot="field"]')?.contains(error)).toBe(true)
  })

  it.each([
    [
      'data:LAST_ADMIN',
      'last-admin',
      'Make another member an administrator, or remove the others.',
    ],
    ['data:RATE_LIMITED', 'rate-limited', 'Too many attempts.'],
    ['data:OFFLINE', 'failed', 'The mail was not sent.'],
  ])('says %s above the form, under no field', (failure, code, text) => {
    renderView({ error: failure })

    const error = screen.getByTestId('user.settings.deletion.error')

    expect(error.getAttribute('data-code')).toBe(code)
    expect(error.textContent).toContain(text)
    expect(input('user.settings.deletion.password-input').getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByTestId('user.settings.deletion.form').contains(error)).toBe(true)
  })

  it('disables the button while the flow takes no send', () => {
    renderView({ canSend: false })

    expect(
      (screen.getByTestId('user.settings.deletion.send-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
