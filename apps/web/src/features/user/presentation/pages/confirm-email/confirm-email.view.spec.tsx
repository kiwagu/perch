// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import es from '../../i18n/user.es.json'

import { ConfirmEmailView, type ConfirmEmailViewProps } from './confirm-email.view'

function renderView(props: Partial<ConfirmEmailViewProps> = {}, locale: 'en' | 'es' = 'en') {
  renderWithProviders(<ConfirmEmailView confirming={false} onward="none" {...props} />, {
    locale,
    es,
  })
}

describe('ConfirmEmailView', () => {
  it('says the link is being checked', () => {
    renderView({ confirming: true })

    expect(screen.getByTestId('user.confirm-email.status').getAttribute('data-state')).toBe(
      'loading',
    )
    expect(screen.queryByTestId('user.confirm-email.message')).toBeNull()
  })

  it.each([
    ['profile', 'user.confirm-email.profile-link', '/me'],
    ['sign-in', 'user.confirm-email.sign-in-link', '/sign-in'],
  ] as const)('says the email is the new one, leading to the %s', (onward, link, to) => {
    renderView({ message: 'email-changed', onward })

    expect(screen.getByTestId('user.confirm-email.message').getAttribute('data-code')).toBe(
      'email-changed',
    )
    expect(screen.getByTestId(link).getAttribute('href')).toBe(to)
    expect(screen.queryByTestId('user.confirm-email.status')).toBeNull()
  })

  it('leads nowhere while another account is signed in here', () => {
    renderView({ message: 'email-changed', onward: 'none' })

    expect(screen.queryByTestId('user.confirm-email.profile-link')).toBeNull()
    expect(screen.queryByTestId('user.confirm-email.sign-in-link')).toBeNull()
  })

  it.each([
    ['data:LINK_INVALID', 'link-invalid'],
    ['data:LINK_EXPIRED', 'link-expired'],
    ['data:RATE_LIMITED', 'rate-limited'],
    ['data:OFFLINE', 'failed'],
  ])('says why the link changed nothing: %s', (failure, code) => {
    renderView({ error: failure })

    expect(screen.getByTestId('user.confirm-email.error').getAttribute('data-code')).toBe(code)
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      es['user.confirm-email.title'],
    )
  })
})
