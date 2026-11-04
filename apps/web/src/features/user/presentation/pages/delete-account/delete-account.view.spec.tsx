// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import es from '../../i18n/user.es.json'

import { DeleteAccountView, type DeleteAccountViewProps } from './delete-account.view'

function renderView(props: Partial<DeleteAccountViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = { onDelete: vi.fn() }

  renderWithProviders(
    <DeleteAccountView guest linkDead={false} canDelete {...handlers} {...props} />,
    { locale, es },
  )

  return handlers
}

const BUTTON = 'user.delete-account.delete-button'

describe('DeleteAccountView', () => {
  it('says what goes with the account, naming none, beside the destructive button that deletes it', () => {
    const { onDelete } = renderView()

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Delete the account')
    expect(screen.getByText(/signs every device of it out/).textContent).toContain(
      'cannot be undone',
    )
    expect(document.body.textContent).not.toContain('@')

    const button = screen.getByTestId(BUTTON) as HTMLButtonElement

    expect(button.textContent).toBe('Delete the account')
    expect(button.className).toContain('text-destructive')

    fireEvent.click(button)

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('user.delete-account.message')).toBeNull()
    expect(screen.queryByTestId('user.delete-account.error')).toBeNull()
    expect(screen.queryByTestId('user.delete-account.sign-in-link')).toBeNull()
  })

  it('holds the button while the flow does not take it', () => {
    renderView({ canDelete: false })

    expect((screen.getByTestId(BUTTON) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says the account is gone beside the link to sign in, with the button gone', () => {
    renderView({ message: 'account-deleted' })

    const message = screen.getByTestId('user.delete-account.message')

    expect(message.getAttribute('data-code')).toBe('account-deleted')
    expect(message.textContent).toContain('every device of it is signed out')
    expect(screen.getByTestId('user.delete-account.sign-in-link').getAttribute('href')).toBe(
      '/sign-in',
    )
    expect(screen.queryByTestId(BUTTON)).toBeNull()
  })

  it('leaves the link to sign in to a guest: another account signed in here keeps the message alone', () => {
    renderView({ message: 'account-deleted', guest: false })

    expect(screen.getByTestId('user.delete-account.message')).toBeTruthy()
    expect(screen.queryByTestId('user.delete-account.sign-in-link')).toBeNull()
  })

  it.each([
    ['data:LINK_INVALID', 'link-invalid'],
    ['data:LINK_EXPIRED', 'link-expired'],
  ])(
    'takes the button away for a link that does not work, asking for a new one: %s',
    (failure, code) => {
      renderView({ error: failure, linkDead: true })

      const error = screen.getByTestId('user.delete-account.error')

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toContain('settings')
      expect(screen.queryByTestId(BUTTON)).toBeNull()
      expect(screen.queryByTestId('user.delete-account.sign-in-link')).toBeNull()
    },
  )

  it.each([
    ['data:LAST_ADMIN', 'last-admin'],
    ['data:RATE_LIMITED', 'rate-limited'],
    ['data:COMMAND_FAILED', 'failed'],
    ['data:OFFLINE', 'failed'],
  ])('says why nothing was deleted and keeps the button: %s', (failure, code) => {
    renderView({ error: failure })

    expect(screen.getByTestId('user.delete-account.error').getAttribute('data-code')).toBe(code)
    expect((screen.getByTestId(BUTTON) as HTMLButtonElement).disabled).toBe(false)
  })

  it('tells the last admin to remove the other members, then press again', () => {
    renderView({ error: 'data:LAST_ADMIN' })

    expect(screen.getByTestId('user.delete-account.error').textContent).toBe(
      'This account is the only admin of an organisation that has other members. Remove them first, then press again.',
    )
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      es['user.delete-account.title'],
    )
    expect(screen.getByTestId(BUTTON).textContent).toBe(es['user.delete-account.delete'])
  })
})
