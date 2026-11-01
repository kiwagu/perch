// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'

import { SettingsView, type SettingsViewProps } from './settings.view'

function renderView(props: Partial<SettingsViewProps> = {}) {
  const handlers = { onTheme: vi.fn(), onLocale: vi.fn() }

  renderWithProviders(
    <SettingsView
      theme="system"
      locale="en"
      canChooseTheme
      canChooseLocale
      {...handlers}
      {...props}
    />,
  )

  return handlers
}

describe('SettingsView', () => {
  it("shows the device's theme and the account's language, each by its value", () => {
    renderView({ theme: 'dark', locale: 'es' })

    expect(screen.getByTestId('user.settings.heading').textContent).toBe('Settings')
    expect(screen.getByTestId('user.settings.theme-select').getAttribute('data-value')).toBe('dark')
    expect(screen.getByTestId('user.settings.locale-select').getAttribute('data-value')).toBe('es')
  })

  it('takes no language while the flow takes none', () => {
    renderView({ canChooseLocale: false })

    expect(screen.getByTestId('user.settings.locale-select').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('user.settings.theme-select').hasAttribute('disabled')).toBe(false)
  })
})
