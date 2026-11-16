// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import type { InvitationErrorCode } from '../../../application/invitation.machine'
import es from '../../i18n/organisation.es.json'

import { type InvitationListed, InvitationView, type InvitationViewProps } from './invitation.view'

const ASKING: readonly InvitationListed[] = [
  'organisation.invitation.heading',
  'organisation.invitation.role-badge',
  'organisation.invitation.accept-button',
  'organisation.invitation.decline-button',
]

/** What a state renders of the anchors only some render: those listed. */
const rendering = (...listed: readonly InvitationListed[]) => {
  const set = new Set(listed)

  return (anchor: InvitationListed) => set.has(anchor)
}

/** The page asking, unless `props` names another state. */
function renderView(props: Partial<InvitationViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = { onAccept: vi.fn(), onDecline: vi.fn() }

  renderWithProviders(
    <InvitationView
      organisation="Acme"
      joinAs="admin"
      renders={rendering(...ASKING)}
      canAccept
      canDecline
      guest={false}
      {...handlers}
      {...props}
    />,
    { locale, es },
  )

  return handlers
}

const ACCEPT = 'organisation.invitation.accept-button'
const DECLINE = 'organisation.invitation.decline-button'
const ERROR = 'organisation.invitation.error'

describe('InvitationView', () => {
  it('says the link is being checked, and nothing else', () => {
    renderView({
      organisation: undefined,
      joinAs: undefined,
      renders: rendering('organisation.invitation.status'),
    })

    const status = screen.getByTestId('organisation.invitation.status')

    expect(status.getAttribute('data-state')).toBe('loading')
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByTestId('organisation.invitation.role-badge')).toBeNull()
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
    expect(screen.queryByTestId(DECLINE)).toBeNull()
    expect(screen.queryByTestId(ERROR)).toBeNull()
  })

  it('names the organisation and the role, with the buttons that accept and decline', () => {
    const { onAccept, onDecline } = renderView()

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme')
    expect(screen.getByTestId('organisation.invitation.heading')).toBe(
      screen.getByRole('heading', { level: 1 }),
    )

    const badge = screen.getByTestId('organisation.invitation.role-badge')

    expect(badge.getAttribute('data-value')).toBe('admin')
    expect(badge.textContent).toBe('Administrator')
    expect(screen.queryByTestId('organisation.invitation.status')).toBeNull()
    expect(screen.queryByTestId('organisation.invitation.message')).toBeNull()
    expect(screen.queryByTestId('organisation.invitation.sign-in-link')).toBeNull()
    expect(screen.queryByTestId(ERROR)).toBeNull()

    const accept = screen.getByTestId(ACCEPT) as HTMLButtonElement
    const decline = screen.getByTestId(DECLINE) as HTMLButtonElement

    expect(accept.textContent).toBe('Accept')
    expect(decline.textContent).toBe('Decline')

    fireEvent.click(accept)
    fireEvent.click(decline)

    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('words the role of a plain member', () => {
    renderView({ joinAs: 'member' })

    const badge = screen.getByTestId('organisation.invitation.role-badge')

    expect(badge.getAttribute('data-value')).toBe('member')
    expect(badge.textContent).toBe('Member')
  })

  it('holds the buttons while the flow takes no press', () => {
    renderView({ canAccept: false, canDecline: false })

    expect((screen.getByTestId(ACCEPT) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId(DECLINE) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no email, anywhere', () => {
    renderView({ error: 'other-account' })

    expect(document.body.textContent).not.toContain('@')
  })

  it('asks a guest to sign in to the account the mail went to, with the link to the sign-in page and no buttons', () => {
    renderView({
      guest: true,
      message: 'sign-in-to-accept',
      renders: rendering(
        'organisation.invitation.heading',
        'organisation.invitation.role-badge',
        'organisation.invitation.message',
        'organisation.invitation.sign-in-link',
      ),
    })

    const message = screen.getByTestId('organisation.invitation.message')

    expect(message.getAttribute('data-code')).toBe('sign-in-to-accept')
    expect(message.textContent).toContain('Sign in')
    expect(screen.getByTestId('organisation.invitation.sign-in-link').getAttribute('href')).toBe(
      '/sign-in',
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme')
    expect(screen.getByTestId('organisation.invitation.role-badge')).toBeTruthy()
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
    expect(screen.queryByTestId(DECLINE)).toBeNull()
  })

  it('leaves the link to sign in to a guest: another account signed in meanwhile keeps the message alone', () => {
    renderView({
      guest: false,
      message: 'sign-in-to-accept',
      renders: rendering(
        'organisation.invitation.heading',
        'organisation.invitation.role-badge',
        'organisation.invitation.message',
        'organisation.invitation.sign-in-link',
      ),
    })

    expect(screen.getByTestId('organisation.invitation.message')).toBeTruthy()
    expect(screen.queryByTestId('organisation.invitation.sign-in-link')).toBeNull()
  })

  it('offers a guest the link to sign in only where the state renders it', () => {
    renderView({ guest: true })

    expect(screen.queryByTestId('organisation.invitation.sign-in-link')).toBeNull()
  })

  it('tells another account signed in that the invitation is not for it, offering nothing', () => {
    renderView({
      error: 'other-account',
      renders: rendering('organisation.invitation.heading', 'organisation.invitation.role-badge'),
    })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme')
    expect(screen.getByTestId('organisation.invitation.role-badge')).toBeTruthy()
    expect(screen.getByTestId(ERROR).getAttribute('data-code')).toBe('other-account')
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
    expect(screen.queryByTestId(DECLINE)).toBeNull()
    expect(screen.queryByTestId('organisation.invitation.sign-in-link')).toBeNull()
  })

  it.each<[InvitationErrorCode, string]>([
    ['link-invalid', 'This link does not work'],
    ['link-expired', 'This link has expired'],
    ['rate-limited', 'Too many attempts'],
    ['other-account', 'This invitation is for another account'],
    ['invitation-gone', 'This invitation is no longer valid'],
    ['already-member', 'This account is already a member'],
    ['failed', 'Something went wrong'],
  ])(
    'shows the error %s with its words, and nothing of the invitation without a heading',
    (code, words) => {
      renderView({ organisation: undefined, joinAs: undefined, error: code, renders: rendering() })

      const error = screen.getByTestId(ERROR)

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toContain(words)
      expect(screen.queryByRole('heading')).toBeNull()
      expect(screen.queryByTestId(ACCEPT)).toBeNull()
    },
  )

  it('shows a refusal of the press beside the buttons', () => {
    renderView({ error: 'already-member' })

    expect(screen.getByTestId(ERROR).getAttribute('data-code')).toBe('already-member')
    expect((screen.getByTestId(ACCEPT) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId(DECLINE) as HTMLButtonElement).disabled).toBe(false)
  })

  it('speaks Spanish', () => {
    renderView({ error: 'invitation-gone' }, 'es')

    expect(screen.getByTestId(ACCEPT).textContent).toBe(es['organisation.invitation.accept'])
    expect(screen.getByTestId(DECLINE).textContent).toBe(es['organisation.invitation.decline'])
    expect(screen.getByTestId(ERROR).textContent).toBe(
      es['organisation.invitation.error.invitation-gone'],
    )
    expect(screen.getByTestId('organisation.invitation.role-badge').textContent).toBe(
      es['organisation.role.admin'],
    )
  })
})
