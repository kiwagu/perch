// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Locale } from '@workspace/i18n'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

import { renderWithFacts } from '../../../../../field-facts.test-support'
import es from '../../../../../platform/i18n/app.es.json'
import { renderWithProviders } from '../../../../../test-utils'

import { HeaderActions, type HeaderActionsProps } from './header-actions.view'

/** A guest's header actions, both choices taken, with `props` over them. */
const actions = (props: Partial<HeaderActionsProps> = {}) => (
  <HeaderActions
    signedIn={false}
    theme="system"
    can={() => true}
    onThemeChange={() => {}}
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
    renderActions({ can: (event) => event.type !== 'app-shell.theme-select' })

    expect(screen.getByTestId('app-shell.theme-select').hasAttribute('data-disabled')).toBe(true)
    expect(screen.getByTestId('app-shell.locale-select').hasAttribute('data-disabled')).toBe(false)
  })

  it("marks a guest's language select", () => {
    renderActions({ signedIn: false })

    expect(screen.getByTestId('app-shell.locale-select').getAttribute('role')).toBe('combobox')
  })

  it('takes a language choice only while the frame takes one', () => {
    const { rerender } = renderActions({ can: (event) => event.type !== 'app-shell.locale-select' })
    const select = screen.getByTestId('app-shell.locale-select')

    expect(select.hasAttribute('data-disabled')).toBe(true)
    expect(screen.getByTestId('app-shell.theme-select').hasAttribute('data-disabled')).toBe(false)

    rerender(actions({ can: () => true }))

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

/** Says whether a field inside the scope holds unsaved input. */
function Unsaved() {
  return <output data-testid="unsaved">{String(useUnsavedInput())}</output>
}

/** The guest's theme choice as the app wires it: the frame gives back what was chosen. */
function GuestTheme() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')

  return (
    <UnsavedInputScope>
      {actions({ theme, onThemeChange: setTheme })}
      <Unsaved />
    </UnsavedInputScope>
  )
}

describe('HeaderActions choices', () => {
  /** Chooses dark in the theme select once its list takes the pointer. */
  async function chooseDark() {
    await userEvent.click(screen.getByTestId('app-shell.theme-select'))

    const option = await screen.findByRole('option', { name: /dark/i })

    await vi.waitFor(() => expect(getComputedStyle(option).pointerEvents).not.toBe('none'))
    await userEvent.click(option)
  }

  it('apply at once: a theme choice leaves no unsaved input, as the facts of its anchor say', async () => {
    renderWithFacts(<GuestTheme />)

    await chooseDark()

    expect(screen.getByTestId('app-shell.theme-select').getAttribute('data-value')).toBe('dark')
    expect(screen.getByTestId('unsaved').textContent).toBe('false')
  })

  it('take their say from the facts alone: without them the select holds its choice as input', async () => {
    renderWithProviders(<GuestTheme />)

    await chooseDark()

    expect(screen.getByTestId('unsaved').textContent).toBe('true')
  })
})
