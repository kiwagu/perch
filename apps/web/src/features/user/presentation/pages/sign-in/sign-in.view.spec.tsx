// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/user.en.json'
import es from '../../i18n/user.es.json'

import { SignInView, type SignInViewProps } from './sign-in.view'

function renderView(props: Partial<SignInViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = { onSubmit: vi.fn(), onToggleMode: vi.fn() }

  renderWithProviders(<SignInView mode="sign-in" submitting={false} {...handlers} {...props} />, {
    locale,
    es,
  })

  return handlers
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

describe('SignInView', () => {
  it('asks for email and password to sign in, and offers to create an account', () => {
    const { onSubmit, onToggleMode } = renderView()

    expect(screen.queryByTestId('user.sign-in.name')).toBeNull()
    expect(screen.getByTestId('user.sign-in.toggle').textContent).toBe(
      en['user.sign-in.create-account'],
    )

    type('user.sign-in.email', 'ann@example.test')
    type('user.sign-in.password', 'secret-ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit'))

    expect(screen.getByTestId('user.sign-in.submit').textContent).toBe(en['user.sign-in.sign-in'])
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ann@example.test',
      password: 'secret-ann',
      name: '',
    })

    fireEvent.click(screen.getByTestId('user.sign-in.toggle'))

    expect(onToggleMode).toHaveBeenCalledOnce()
  })

  it('also asks for a name to create an account', () => {
    const { onSubmit } = renderView({ mode: 'sign-up' })

    type('user.sign-in.email', 'ann@example.test')
    type('user.sign-in.password', 'secret-ann')
    type('user.sign-in.name', 'Ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit'))

    expect(screen.getByTestId('user.sign-in.submit').textContent).toBe(en['user.sign-in.sign-up'])
    expect(screen.getByTestId('user.sign-in.toggle').textContent).toBe(
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

    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.invalid-credentials'],
    )
  })

  it('says nothing about refused keys unless the session left a notice', () => {
    renderView()

    expect(screen.queryByTestId('user.sign-in.notice.resend-after-sign-in')).toBeNull()
  })

  it('asks to sign in again to send the changes this device kept when its keys were refused', () => {
    renderView({ notice: 'resend-after-sign-in' })

    expect(screen.getByTestId('user.sign-in.notice.resend-after-sign-in').textContent).toBe(
      en['user.sign-in.notice.resend-after-sign-in'],
    )
  })

  it('asks the same in Spanish', () => {
    renderView({ notice: 'resend-after-sign-in' }, 'es')

    expect(screen.getByTestId('user.sign-in.notice.resend-after-sign-in').textContent).toBe(
      es['user.sign-in.notice.resend-after-sign-in'],
    )
  })

  it('holds the form while an attempt is running', () => {
    renderView({ submitting: true })

    expect((screen.getByTestId('user.sign-in.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByTestId('user.sign-in.submit').textContent).toBe(es['user.sign-in.sign-in'])
  })
})
