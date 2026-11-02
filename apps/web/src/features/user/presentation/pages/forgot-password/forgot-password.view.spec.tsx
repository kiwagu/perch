// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import es from '../../i18n/user.es.json'

import { ForgotPasswordView, type ForgotPasswordViewProps } from './forgot-password.view'

function renderView(props: Partial<ForgotPasswordViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const onSend = vi.fn((_email: string) => Promise.resolve(true))

  renderWithProviders(<ForgotPasswordView startEmail="" canSend onSend={onSend} {...props} />, {
    locale,
    es,
  })

  return { onSend }
}

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

describe('ForgotPasswordView', () => {
  it('starts with the email the sign-in page carried, and asks for the mail with the email typed', () => {
    const { onSend } = renderView({ startEmail: 'ann@example.test' })

    expect(input('user.forgot-password.email-input').value).toBe('ann@example.test')

    fireEvent.change(input('user.forgot-password.email-input'), {
      target: { value: 'bob@example.test' },
    })
    fireEvent.submit(screen.getByTestId('user.forgot-password.form'))

    expect(onSend).toHaveBeenCalledWith('bob@example.test')
    expect(screen.getByTestId('user.forgot-password.sign-in-link').getAttribute('href')).toBe(
      '/sign-in',
    )
  })

  it('asks to open the link of the mail, naming where it went', () => {
    renderView({ message: 'check-your-mail', sentTo: 'ann@example.test' })

    const message = screen.getByTestId('user.forgot-password.message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain('ann@example.test')
  })

  it.each([
    ['data:RATE_LIMITED', 'rate-limited'],
    ['data:OFFLINE', 'failed'],
    ['data:WRITE_FAILED', 'failed'],
  ])('says why the mail was not asked for: %s is %s', (failure, code) => {
    renderView({ error: failure })

    expect(screen.getByTestId('user.forgot-password.error').getAttribute('data-code')).toBe(code)
  })

  it('holds the send button while the flow does not take it', () => {
    renderView({ canSend: false })

    expect(
      (screen.getByTestId('user.forgot-password.send-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      es['user.forgot-password.title'],
    )
  })
})
