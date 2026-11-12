import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AppShell } from '@workspace/ui/components/platform/app-shell'

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('AppShell', () => {
  it('renders the navigation as a marked <nav>, and keeps room for its bottom bar', () => {
    render(
      <AppShell
        brand="Perch"
        navigation={<a href="/me">Profile</a>}
        navigationLabel="Main navigation"
        navigationTestId="x.nav"
      >
        <p>page</p>
      </AppShell>,
    )

    const navigation = screen.getByTestId('x.nav')

    expect(navigation.tagName).toBe('NAV')
    expect(navigation.getAttribute('aria-label')).toBe('Main navigation')
    expect(screen.getByRole('main').className).toContain('pb-24')
  })

  it('renders no navigation without items, and the page keeps no room for a bar', () => {
    render(
      <AppShell brand="Perch" navigationLabel="Main navigation" navigationTestId="x.nav">
        <p>page</p>
      </AppShell>,
    )

    expect(screen.queryByTestId('x.nav')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByRole('main').className).not.toContain('pb-24')
    expect(screen.getByText('page')).toBeTruthy()
  })
})
