// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { expectEachCodeMarksItsField } from '../../../../../error-fields.test-support'
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

  renderWithProviders(<PasswordFormView values={EMPTY} can={() => true} {...handlers} {...props} />)

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

  it('limits the new password as its value does, and the current one and the confirmation by no length', () => {
    renderView()

    expect(input(NEW).maxLength).toBe(35)
    expect(input(CURRENT).hasAttribute('maxlength')).toBe(false)
    expect(input(CONFIRMATION).hasAttribute('maxlength')).toBe(false)
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

  it("marks the field each code concerns, as the screen's fields say, and no other", () => {
    const failures: Readonly<Record<string, string>> = {
      'invalid-credentials': 'data:INVALID_CREDENTIALS',
      'password-rejected': 'data:PASSWORD_REJECTED',
      'passwords-differ': SETTINGS_PASSWORDS_DIFFER,
    }

    expectEachCodeMarksItsField('user.settings.password.error', (code) =>
      renderView({ error: failures[code] }),
    )
  })

  it('says a refusal that concerns no field above the form, and holds the save the flow does not take', () => {
    renderView({ error: 'data:RATE_LIMITED', can: () => false })

    expect(screen.getByTestId('user.settings.password.error').getAttribute('data-code')).toBe(
      'rate-limited',
    )
    expect(
      (screen.getByTestId('user.settings.password.save-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('asks the flow about the save with the three passwords it holds', () => {
    const can = vi.fn(() => true)

    renderView({
      values: { current: 'Secret-old1', password: 'Secret-new1', confirmation: 'Secret-new1' },
      can,
    })

    expect(can).toHaveBeenCalledWith({
      type: 'user.settings.password.save-button',
      currentPassword: 'Secret-old1',
      password: 'Secret-new1',
      confirmation: 'Secret-new1',
    })
  })
})
