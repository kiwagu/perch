// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import { SETTINGS_PASSWORDS_DIFFER } from '../../../application/settings/settings-machine'

import {
  type PasswordFormValues,
  PasswordFormView,
  type PasswordFormViewProps,
} from './password-form.view'

const EMPTY: PasswordFormValues = { current: '', password: '', confirmation: '' }

const CURRENT = 'user.settings.password.current-password-input'
const NEW = 'user.settings.password.new-password-input'
const CONFIRMATION = 'user.settings.password.password-confirmation-input'

function renderView(props: Partial<PasswordFormViewProps> = {}) {
  const handlers = { onChange: vi.fn(), onSave: vi.fn(() => Promise.resolve(true)) }

  renderWithProviders(<PasswordFormView values={EMPTY} canSave {...handlers} {...props} />)

  return handlers
}

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

describe('PasswordFormView', () => {
  it('tells each keystroke with every value as it is after it', () => {
    const { onChange } = renderView({ values: { ...EMPTY, current: 'Secret-old1' } })

    fireEvent.change(input(NEW), { target: { value: 'Secret-new1' } })

    expect(onChange).toHaveBeenCalledWith('password', {
      current: 'Secret-old1',
      password: 'Secret-new1',
      confirmation: '',
    })
  })

  it('shows the values the page gives it, the rules the new one keeps, and the eye of each password', () => {
    renderView({ values: { current: 'Secret-old1', password: 'abcdefghij', confirmation: '' } })

    expect(input(CURRENT).value).toBe('Secret-old1')
    expect(
      screen
        .getByTestId('user.settings.password-rule-list.lowercase-item')
        .getAttribute('data-state'),
    ).toBe('met')

    for (const testId of [CURRENT, NEW, CONFIRMATION]) {
      fireEvent.click(screen.getByTestId(`${testId}.visibility-button`))

      expect(input(testId).type).toBe('text')
    }
  })

  it.each([
    ['data:INVALID_CREDENTIALS', 'invalid-credentials', CURRENT],
    ['data:PASSWORD_REJECTED', 'password-rejected', NEW],
    [SETTINGS_PASSWORDS_DIFFER, 'passwords-differ', CONFIRMATION],
  ])('says %s under the field it concerns', (failure, code, field) => {
    renderView({ error: failure })

    const error = screen.getByTestId('user.settings.password.error')

    expect(error.getAttribute('data-code')).toBe(code)
    expect(input(field).getAttribute('aria-invalid')).toBe('true')
    expect(input(field).closest('[data-slot="field"]')?.contains(error)).toBe(true)
  })

  it('says a refusal that concerns no field above the form, and holds the save the flow does not take', () => {
    renderView({ error: 'data:RATE_LIMITED', canSave: false })

    expect(screen.getByTestId('user.settings.password.error').getAttribute('data-code')).toBe(
      'rate-limited',
    )
    expect(
      (screen.getByTestId('user.settings.password.save-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
