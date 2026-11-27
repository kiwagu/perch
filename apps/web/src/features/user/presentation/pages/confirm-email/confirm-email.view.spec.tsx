// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { renderWithProviders } from '../../../../../test-utils'
import es from '../../i18n/user.es.json'

import {
  type ConfirmEmailListed,
  ConfirmEmailView,
  type ConfirmEmailViewProps,
} from './confirm-email.view'

/** What a state renders of the anchors only some render: `anchor` alone. */
const only = (anchor: ConfirmEmailListed) => (asked: ConfirmEmailListed) => asked === anchor

function renderView(props: Partial<ConfirmEmailViewProps> = {}, locale: 'en' | 'es' = 'en') {
  renderWithProviders(<ConfirmEmailView renders={() => false} guest={false} {...props} />, {
    locale,
    es,
  })
}

describe('ConfirmEmailView', () => {
  it('says the link is being checked', () => {
    renderView({ renders: only('user.confirm-email.status') })

    expect(screen.getByTestId('user.confirm-email.status').getAttribute('data-state')).toBe(
      'loading',
    )
    expect(screen.queryByTestId('user.confirm-email.message')).toBeNull()
  })

  it.each([
    ['profile', 'user.confirm-email.profile-link', CONTRACT_ROUTES['user.profile'], false],
    ['sign-in', 'user.confirm-email.sign-in-link', CONTRACT_ROUTES['user.sign-in'], true],
  ] as const)('says the email is the new one, leading to the %s', (_onward, link, to, guest) => {
    renderView({ message: 'email-changed', renders: only(link), guest })

    expect(screen.getByTestId('user.confirm-email.message').getAttribute('data-code')).toBe(
      'email-changed',
    )
    expect(screen.getByTestId(link).getAttribute('href')).toBe(to)
    expect(screen.queryByTestId('user.confirm-email.status')).toBeNull()
  })

  it.each([
    ['profile', 'user.confirm-email.profile-link', true],
    ['sign-in', 'user.confirm-email.sign-in-link', false],
  ] as const)(
    'leaves the %s link out for the roles its route does not serve, though the state renders it',
    (_onward, link, guest) => {
      renderView({ message: 'email-changed', renders: only(link), guest })

      expect(screen.getByTestId('user.confirm-email.message').getAttribute('data-code')).toBe(
        'email-changed',
      )
      expect(screen.queryByTestId(link)).toBeNull()
    },
  )

  it('leads nowhere while another account is signed in here', () => {
    renderView({ message: 'email-changed' })

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
