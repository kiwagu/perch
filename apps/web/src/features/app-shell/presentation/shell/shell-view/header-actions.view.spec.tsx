// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Locale } from '@workspace/i18n'

import es from '../../../../../platform/i18n/app.es.json'
import { renderWithProviders } from '../../../../../test-utils'

import { HeaderActions, type HeaderActionsProps } from './header-actions.view'

/** A guest's header actions, both choices taken, with `props` over them. */
const actions = (props: Partial<HeaderActionsProps> = {}) => (
  <HeaderActions
    signedIn={false}
    theme="system"
    canChooseTheme={true}
    onThemeChange={() => {}}
    canChooseLocale={true}
    onLocaleChange={() => {}}
    {...props}
  />
)

function renderActions(props: Partial<HeaderActionsProps> & { readonly locale?: Locale } = {}) {
  const { locale = 'en', ...rest } = props

  return renderWithProviders(actions(rest), { locale, es })
}

describe('HeaderActions', () => {
  it("shows a guest the device's theme, and a signed-in account no theme select", () => {
    const { unmount } = renderActions({ theme: 'dark' })
    const select = screen.getByTestId('app-shell.theme-select')

    expect(select.getAttribute('role')).toBe('combobox')
    expect(select.getAttribute('data-value')).toBe('dark')
    unmount()

    renderActions({ signedIn: true, theme: 'light' })

    expect(screen.queryByTestId('app-shell.theme-select')).toBeNull()
  })

  it('takes a theme choice only while the frame takes one', () => {
    renderActions({ canChooseTheme: false })

    expect(screen.getByTestId('app-shell.theme-select').hasAttribute('data-disabled')).toBe(true)
  })

  it("marks a guest's language select", () => {
    renderActions({ signedIn: false })

    expect(screen.getByTestId('app-shell.locale-select').getAttribute('role')).toBe('combobox')
  })

  it('takes a language choice only while the frame takes one', () => {
    const { rerender } = renderActions({ canChooseLocale: false })
    const select = screen.getByTestId('app-shell.locale-select')

    expect(select.hasAttribute('data-disabled')).toBe(true)

    rerender(actions({ canChooseLocale: true }))

    expect(screen.getByTestId('app-shell.locale-select').hasAttribute('data-disabled')).toBe(false)
  })

  it("says the state of this device's sync, in the language the app speaks", () => {
    renderActions({ signedIn: true, sync: 'offline', locale: 'es' })

    const sync = screen.getByTestId('app-shell.sync-message')

    expect(sync.getAttribute('data-code')).toBe('offline')
    expect(sync.getAttribute('role')).toBe('status')
    expect(sync.textContent).toBe(es['app.shell.sync.offline'])
  })

  it('shows no state of the sync without one, as for a guest', () => {
    renderActions()

    expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()
  })
})
