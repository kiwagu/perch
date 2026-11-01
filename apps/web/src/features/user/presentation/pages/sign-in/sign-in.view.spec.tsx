// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/user.en.json'
import es from '../../i18n/user.es.json'

import { SignInView, type SignInViewProps } from './sign-in.view'

function renderView(props: Partial<SignInViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = {
    onSubmit: vi.fn(() => Promise.resolve(true)),
    onToggleMode: vi.fn(),
    onResend: vi.fn((_email: string) => Promise.resolve(true)),
  }

  renderWithProviders(
    <SignInView
      mode="sign-in"
      submitting={false}
      showResend={false}
      canResend={false}
      {...handlers}
      {...props}
    />,
    { locale, es },
  )

  return handlers
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

/** The notice of the last session, once it carries `code`. */
function noticeWith(code: string): HTMLElement {
  const notice = screen.getByTestId('user.sign-in.notice-message')

  expect(notice.getAttribute('data-code')).toBe(code)

  return notice
}

describe('SignInView', () => {
  it('asks for email and password to sign in, and offers to create an account', () => {
    const { onSubmit, onToggleMode } = renderView()

    expect(screen.getByTestId('user.sign-in.form').tagName).toBe('FORM')
    expect(screen.queryByTestId('user.sign-in.name-input')).toBeNull()
    expect(screen.getByTestId('user.sign-in.toggle-button').getAttribute('data-value')).toBe(
      'sign-up',
    )
    expect(screen.getByTestId('user.sign-in.toggle-button').textContent).toBe(
      en['user.sign-in.create-account'],
    )

    type('user.sign-in.email-input', 'ann@example.test')
    type('user.sign-in.password-input', 'secret-ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    expect(screen.getByTestId('user.sign-in.submit-button').textContent).toBe(
      en['user.sign-in.sign-in'],
    )
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ann@example.test',
      password: 'secret-ann',
      name: '',
    })

    fireEvent.click(screen.getByTestId('user.sign-in.toggle-button'))

    expect(onToggleMode).toHaveBeenCalledOnce()
  })

  it('also asks for a name to create an account', () => {
    const { onSubmit } = renderView({ mode: 'sign-up' })

    type('user.sign-in.email-input', 'ann@example.test')
    type('user.sign-in.password-input', 'secret-ann')
    type('user.sign-in.name-input', 'Ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    expect(screen.getByTestId('user.sign-in.submit-button').textContent).toBe(
      en['user.sign-in.sign-up'],
    )
    expect(screen.getByTestId('user.sign-in.toggle-button').getAttribute('data-value')).toBe(
      'sign-in',
    )
    expect(screen.getByTestId('user.sign-in.toggle-button').textContent).toBe(
      en['user.sign-in.have-account'],
    )
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ann@example.test',
      password: 'secret-ann',
      name: 'Ann',
    })
  })

  it('explains why the last attempt failed', () => {
    renderView({ error: 'data:INVALID_CREDENTIALS' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'invalid-credentials',
    )
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.invalid-credentials'],
    )
  })

  it('asks to wait when the gateway limits the attempts', () => {
    renderView({ error: 'data:RATE_LIMITED' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe('rate-limited')
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.rate-limited'],
    )
  })

  it('asks to sign the other account out first when another one is signed in on this browser', () => {
    renderView({ error: 'data:OTHER_ACCOUNT' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe('other-account')
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      'Another account is signed in on this browser. Sign it out first.',
    )
  })

  it('says the email is not verified yet when a sign-in was refused for it', () => {
    renderView({ error: 'data:EMAIL_NOT_VERIFIED' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'email-not-verified',
    )
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.email-not-verified'],
    )
  })

  it('asks to open the link of the mail sent to the address it went to, whatever the field holds', () => {
    renderView({ mail: 'check-your-mail', sentTo: 'ann@example.test' })
    type('user.sign-in.email-input', 'bob@example.test')

    const message = screen.getByTestId('user.sign-in.mail-message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toBe(
      en['user.sign-in.mail.check-your-mail'].replace('{email}', 'ann@example.test'),
    )
  })

  it('asks it in Spanish', () => {
    renderView({ mail: 'check-your-mail', sentTo: 'ann@example.test' }, 'es')

    expect(screen.getByTestId('user.sign-in.mail-message').textContent).toBe(
      es['user.sign-in.mail.check-your-mail'].replace('{email}', 'ann@example.test'),
    )
  })

  it('shows no mail message and no resend unless told', () => {
    renderView()

    expect(screen.queryByTestId('user.sign-in.mail-message')).toBeNull()
    expect(screen.queryByTestId('user.sign-in.resend-button')).toBeNull()
  })

  it('offers to send the mail again to the email typed', () => {
    const { onResend, onSubmit } = renderView({ showResend: true, canResend: true })

    type('user.sign-in.email-input', 'ann@example.test')

    const resend = screen.getByTestId('user.sign-in.resend-button') as HTMLButtonElement

    expect(resend.textContent).toBe(en['user.sign-in.resend'])
    expect(resend.disabled).toBe(false)

    fireEvent.click(resend)

    expect(onResend).toHaveBeenCalledWith('ann@example.test')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('holds the resend while it cannot run', () => {
    const { onResend } = renderView({ showResend: true, canResend: false })
    const resend = screen.getByTestId('user.sign-in.resend-button') as HTMLButtonElement

    expect(resend.disabled).toBe(true)

    fireEvent.click(resend)

    expect(onResend).not.toHaveBeenCalled()
  })

  it('says nothing about how the last session ended unless the session left a notice', () => {
    renderView()

    expect(screen.queryByTestId('user.sign-in.notice-message')).toBeNull()
  })

  it('asks to sign in again to send the changes this device kept when it was signed out', () => {
    renderView({ notice: 'resend-after-sign-in' })

    expect(noticeWith('resend-after-sign-in').textContent).toBe(
      en['user.sign-in.notice.resend-after-sign-in'],
    )
  })

  it('asks the same in Spanish', () => {
    renderView({ notice: 'resend-after-sign-in' }, 'es')

    expect(noticeWith('resend-after-sign-in').textContent).toBe(
      es['user.sign-in.notice.resend-after-sign-in'],
    )
  })

  it('says the device was signed out from another device', () => {
    renderView({ notice: 'signed-out-elsewhere' })

    expect(noticeWith('signed-out-elsewhere').textContent).toBe(
      'You were signed out from another device.',
    )
  })

  it('says the data leaves this device once the other tabs are closed when another tab held its delete up', () => {
    renderView({ notice: 'delete-pending' })

    expect(noticeWith('delete-pending').textContent).toBe(
      'You are signed out. Your data leaves this device once the other Perch tabs are closed.',
    )
  })

  it('says it in Spanish', () => {
    renderView({ notice: 'signed-out-elsewhere' }, 'es')

    expect(noticeWith('signed-out-elsewhere').textContent).toBe(
      es['user.sign-in.notice.signed-out-elsewhere'],
    )
  })

  it('holds the form while an attempt is running', () => {
    renderView({ submitting: true })

    expect((screen.getByTestId('user.sign-in.submit-button') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByTestId('user.sign-in.submit-button').textContent).toBe(
      es['user.sign-in.sign-in'],
    )
  })
})
