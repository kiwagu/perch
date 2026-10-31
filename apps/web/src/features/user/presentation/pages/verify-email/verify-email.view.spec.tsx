// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/user.en.json'
import es from '../../i18n/user.es.json'

import { VerifyEmailView, type VerifyEmailViewProps } from './verify-email.view'

function renderView(props: Partial<VerifyEmailViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const onResend = vi.fn((_email: string) => Promise.resolve(true))

  renderWithProviders(
    <VerifyEmailView
      verifying={false}
      showForm={false}
      canResend={false}
      onResend={onResend}
      {...props}
    />,
    { locale, es },
  )

  return { onResend }
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

describe('VerifyEmailView', () => {
  it('says the link is being checked, under its heading', () => {
    renderView({ verifying: true })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      en['user.verify-email.title'],
    )

    const status = screen.getByTestId('user.verify-email.status')

    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('data-state')).toBe('loading')
    expect(status.textContent).toBe(en['user.verify-email.checking'])
    expect(screen.queryByTestId('user.verify-email.message')).toBeNull()
    expect(screen.queryByTestId('user.verify-email.error')).toBeNull()
    expect(screen.queryByTestId('user.verify-email.form')).toBeNull()
  })

  it('says a link verified before is verified, beside the link to sign in', () => {
    renderView({ message: 'verified-before' })

    const message = screen.getByTestId('user.verify-email.message')

    expect(message.getAttribute('data-code')).toBe('verified-before')
    expect(message.textContent).toBe(en['user.verify-email.message.verified-before'])

    const link = screen.getByTestId('user.verify-email.sign-in-link')

    expect(link.getAttribute('href')).toBe('/sign-in')
    expect(link.textContent).toBe(en['user.verify-email.sign-in'])
    expect(screen.queryByTestId('user.verify-email.status')).toBeNull()
    expect(screen.queryByTestId('user.verify-email.form')).toBeNull()
  })

  it.each([
    ['data:LINK_INVALID', 'link-invalid'],
    ['data:LINK_EXPIRED', 'link-expired'],
    ['data:OTHER_ACCOUNT', 'other-account'],
    ['data:RATE_LIMITED', 'rate-limited'],
    ['data:OFFLINE', 'failed'],
    ['verify-email:UNKNOWN', 'failed'],
  ] as const)('shows %s as %s, with the form that sends a new link', (error, code) => {
    renderView({ error, showForm: true, canResend: true })

    const shown = screen.getByTestId('user.verify-email.error')

    expect(shown.getAttribute('data-code')).toBe(code)
    expect(shown.textContent).toBe(en[`user.verify-email.error.${code}`])
    expect(screen.getByTestId('user.verify-email.form').tagName).toBe('FORM')
    expect(screen.getByTestId('user.verify-email.email-input').getAttribute('type')).toBe('email')
    expect(screen.getByTestId('user.verify-email.resend-button').hasAttribute('disabled')).toBe(
      false,
    )
    expect(screen.queryByTestId('user.verify-email.sign-in-link')).toBeNull()
  })

  it('sends a new link to the email typed', () => {
    const { onResend } = renderView({ error: 'data:LINK_INVALID', showForm: true, canResend: true })

    type('user.verify-email.email-input', 'ann@example.test')
    fireEvent.click(screen.getByTestId('user.verify-email.resend-button'))

    expect(onResend).toHaveBeenCalledExactlyOnceWith('ann@example.test')
    expect(screen.getByTestId('user.verify-email.resend-button').textContent).toBe(
      en['user.verify-email.resend'],
    )
  })

  it('holds the button while it cannot send', () => {
    renderView({ error: 'data:LINK_INVALID', showForm: true, canResend: false })

    expect(screen.getByTestId('user.verify-email.resend-button').hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('says a new link is on its way to the address it went to, which editing the field does not change', () => {
    renderView({
      message: 'check-your-mail',
      sentTo: 'ann@example.test',
      showForm: true,
      canResend: true,
    })

    type('user.verify-email.email-input', 'someone-else@example.test')

    const message = screen.getByTestId('user.verify-email.message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain('ann@example.test')
    expect(message.textContent).not.toContain('someone-else@example.test')
    expect(screen.queryByTestId('user.verify-email.sign-in-link')).toBeNull()
    expect(screen.getByTestId('user.verify-email.form')).toBeTruthy()
  })

  it('speaks the language the app speaks', () => {
    renderView({ error: 'data:LINK_EXPIRED', showForm: true, canResend: true }, 'es')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      es['user.verify-email.title'],
    )
    expect(screen.getByTestId('user.verify-email.error').textContent).toBe(
      es['user.verify-email.error.link-expired'],
    )
  })
})
