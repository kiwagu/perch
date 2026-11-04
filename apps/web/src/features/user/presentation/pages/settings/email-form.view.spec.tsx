// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'

import { EmailFormView, type EmailFormViewProps } from './email-form.view'

function renderView(props: Partial<EmailFormViewProps> = {}) {
  const handlers = { onChange: vi.fn(), onSend: vi.fn(() => Promise.resolve(true)) }

  renderWithProviders(
    <EmailFormView values={{ email: '', password: '' }} canSend {...handlers} {...props} />,
  )

  return handlers
}

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

describe('EmailFormView', () => {
  it('tells each keystroke, and sends', () => {
    const { onChange, onSend } = renderView()

    fireEvent.change(input('user.settings.email.email-input'), {
      target: { value: 'ann.new@example.test' },
    })
    fireEvent.submit(screen.getByTestId('user.settings.email.form'))

    expect(onChange).toHaveBeenCalledWith({ email: 'ann.new@example.test', password: '' })
    expect(onSend).toHaveBeenCalled()
    expect(input('user.settings.email.password-input').type).toBe('password')
    expect(screen.getByTestId('user.settings.email.password-input.visibility-button')).toBeTruthy()
  })

  it('asks to open the link of the mail, naming the new email', () => {
    renderView({ message: 'check-your-mail', sentTo: 'ann.new@example.test' })

    const message = screen.getByTestId('user.settings.email.message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain('ann.new@example.test')
  })

  it.each([
    ['data:INVALID_CREDENTIALS', 'invalid-credentials', 'user.settings.email.password-input'],
    ['data:EMAIL_INVALID', 'email-invalid', 'user.settings.email.email-input'],
  ])('says %s under the field it concerns', (failure, code, field) => {
    renderView({ error: failure })

    const error = screen.getByTestId('user.settings.email.error')

    expect(error.getAttribute('data-code')).toBe(code)
    expect(input(field).getAttribute('aria-invalid')).toBe('true')
    expect(input(field).closest('[data-slot="field"]')?.contains(error)).toBe(true)
  })

  it('says any other refusal above the form', () => {
    renderView({ error: 'data:OFFLINE', canSend: false })

    expect(screen.getByTestId('user.settings.email.error').getAttribute('data-code')).toBe('failed')
    expect(
      (screen.getByTestId('user.settings.email.send-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
