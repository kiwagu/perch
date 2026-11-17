// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UnsavedInputScope } from '@workspace/ui/unsaved-input'

import { expectNoStateColour } from '../../../../../field-state-colour.test-support'
import { renderWithProviders } from '../../../../../test-utils'
import { RESET_PASSWORDS_DIFFER } from '../../../application/reset-password.machine'
import es from '../../i18n/user.es.json'

import {
  type ResetPasswordListed,
  ResetPasswordView,
  type ResetPasswordViewProps,
} from './reset-password.view'

/** What a state renders of the anchors only some render: `anchor` alone. */
const only = (anchor: ResetPasswordListed) => (asked: ResetPasswordListed) => asked === anchor

/** Renders the view in a state that renders the form, unless `props` says otherwise. */
function renderView(props: Partial<ResetPasswordViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = {
    onTypePassword: vi.fn(),
    onSubmit: vi.fn(() => Promise.resolve(true)),
  }

  renderWithProviders(
    <ResetPasswordView
      renders={only('user.reset-password.form')}
      canSubmit
      {...handlers}
      {...props}
    />,
    { locale, es },
  )

  return handlers
}

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement
const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

const PASSWORD = 'user.reset-password.password-input'
const CONFIRMATION = 'user.reset-password.password-confirmation-input'

describe('ResetPasswordView', () => {
  it('tells each keystroke with both passwords, marks the rules kept, and sets both as typed', () => {
    const { onTypePassword, onSubmit } = renderView()

    type(PASSWORD, 'abcdefghij')

    expect(onTypePassword).toHaveBeenLastCalledWith('password', {
      password: 'abcdefghij',
      confirmation: '',
    })
    expect(
      screen
        .getByTestId('user.reset-password.password-rule-list.lowercase-item')
        .getAttribute('data-state'),
    ).toBe('met')
    expect(
      screen
        .getByTestId('user.reset-password.password-rule-list.digit-item')
        .getAttribute('data-state'),
    ).toBeNull()

    type(PASSWORD, 'Secret-new1')
    type(CONFIRMATION, 'Secret-new1')
    fireEvent.submit(screen.getByTestId('user.reset-password.form'))

    expect(onTypePassword).toHaveBeenLastCalledWith('confirmation', {
      password: 'Secret-new1',
      confirmation: 'Secret-new1',
    })
    expect(onSubmit).toHaveBeenCalledWith({ password: 'Secret-new1', confirmation: 'Secret-new1' })
  })

  it('renders the eye of both passwords', () => {
    renderView()

    for (const testId of [PASSWORD, CONFIRMATION]) {
      fireEvent.click(screen.getByTestId(`${testId}.visibility-button`))

      expect(input(testId).type).toBe('text')
    }
  })

  it.each([
    ['data:PASSWORD_REJECTED', 'password-rejected', PASSWORD],
    [RESET_PASSWORDS_DIFFER, 'passwords-differ', CONFIRMATION],
  ])('says %s under the field it concerns, marking it invalid', (failure, code, field) => {
    renderView({ error: failure })

    const error = screen.getByTestId('user.reset-password.error')

    expect(error.getAttribute('data-code')).toBe(code)
    expect(input(field).getAttribute('aria-invalid')).toBe('true')
    expect(input(field).closest('[data-slot="field"]')?.contains(error)).toBe(true)
  })

  it('says a refusal that concerns no field above the form', () => {
    renderView({ error: 'data:RATE_LIMITED' })

    expect(screen.getByTestId('user.reset-password.error').getAttribute('data-code')).toBe(
      'rate-limited',
    )
    expect(input(PASSWORD).getAttribute('aria-invalid')).toBeNull()
  })

  it.each([
    ['data:LINK_INVALID', 'link-invalid'],
    ['data:LINK_EXPIRED', 'link-expired'],
  ])(
    'takes the form away for a link that does not work, offering a new one: %s',
    (failure, code) => {
      renderView({ error: failure, renders: only('user.reset-password.forgot-link') })

      expect(screen.getByTestId('user.reset-password.error').getAttribute('data-code')).toBe(code)
      expect(screen.getByTestId('user.reset-password.forgot-link').getAttribute('href')).toBe(
        '/forgot-password',
      )
      expect(screen.queryByTestId('user.reset-password.form')).toBeNull()
    },
  )

  it('says the password is the new one beside the link to sign in', () => {
    renderView({ message: 'password-reset', renders: only('user.reset-password.sign-in-link') })

    expect(screen.getByTestId('user.reset-password.message').getAttribute('data-code')).toBe(
      'password-reset',
    )
    expect(screen.getByTestId('user.reset-password.sign-in-link').getAttribute('href')).toBe(
      '/sign-in',
    )
    expect(screen.queryByTestId('user.reset-password.form')).toBeNull()
  })

  it('holds the submit while the flow does not take it', () => {
    renderView({ canSubmit: false })

    expect(
      (screen.getByTestId('user.reset-password.submit-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      es['user.reset-password.title'],
    )
  })
})

describe('the state colour of the fields', () => {
  it.each([PASSWORD, CONFIRMATION])('draws none on %s', (testId) => {
    renderWithProviders(
      <UnsavedInputScope>
        <ResetPasswordView
          renders={only('user.reset-password.form')}
          canSubmit
          onTypePassword={() => {}}
          onSubmit={() => Promise.resolve(true)}
        />
      </UnsavedInputScope>,
    )

    type(testId, 'Abcdefghi1!')

    expectNoStateColour(screen.getByTestId(testId))
  })
})
