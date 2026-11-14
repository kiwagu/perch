// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../../platform/i18n/app.en.json'
import { renderWithProviders } from '../../../../../test-utils'

import { SignOutHere } from './sign-out-here.view'

describe('SignOutHere', () => {
  it('signs the saved account out on this device', () => {
    const signOutHere = vi.fn()

    renderWithProviders(<SignOutHere onSignOutHere={signOutHere} />)

    const button = screen.getByTestId('app-shell.sign-out-here-button')

    expect(button.textContent).toBe(en['app.shell.sign-out-here'])
    fireEvent.click(button)
    expect(signOutHere).toHaveBeenCalledOnce()
  })

  it('holds the button while the sign-out runs', () => {
    renderWithProviders(<SignOutHere onSignOutHere={() => {}} signingOutHere={true} />)

    expect(screen.getByTestId('app-shell.sign-out-here-button').hasAttribute('disabled')).toBe(true)
  })
})
