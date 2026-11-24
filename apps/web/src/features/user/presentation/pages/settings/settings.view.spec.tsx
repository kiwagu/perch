// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'

import { SettingsView, type SettingsViewProps } from './settings.view'

function renderView(props: Partial<SettingsViewProps> = {}) {
  const handlers = { onTheme: vi.fn(), onLocale: vi.fn() }

  renderWithProviders(
    <SettingsView theme="system" locale="en" can={() => true} {...handlers} {...props} />,
  )

  return handlers
}

describe('SettingsView', () => {
  it("shows the account's theme and language, each by its value", () => {
    renderView({ theme: 'dark', locale: 'es' })

    expect(screen.getByTestId('user.settings.heading').textContent).toBe('Settings')
    expect(screen.getByTestId('user.settings.theme-select').getAttribute('data-value')).toBe('dark')
    expect(screen.getByTestId('user.settings.locale-select').getAttribute('data-value')).toBe('es')
  })

  it('takes no language while the flow takes none', () => {
    renderView({ can: (event) => event.type !== 'user.settings.locale-select' })

    expect(screen.getByTestId('user.settings.locale-select').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('user.settings.theme-select').hasAttribute('disabled')).toBe(false)
  })

  it('takes no theme while the flow takes none', () => {
    renderView({ can: (event) => event.type !== 'user.settings.theme-select' })

    expect(screen.getByTestId('user.settings.theme-select').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('user.settings.locale-select').hasAttribute('disabled')).toBe(false)
  })

  it('asks the flow about each choice with the value it shows', () => {
    const can = vi.fn(() => true)

    renderView({ theme: 'dark', locale: 'es', can })

    expect(can).toHaveBeenCalledWith({ type: 'user.settings.theme-select', theme: 'dark' })
    expect(can).toHaveBeenCalledWith({ type: 'user.settings.locale-select', locale: 'es' })
  })
})
