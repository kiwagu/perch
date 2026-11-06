// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from '../../../../../platform/i18n/app.en.json'
import { renderWithProviders } from '../../../../../test-utils'

import { NavigationLinks, type ShellLinkProps } from './navigation-links.view'

describe('NavigationLinks', () => {
  it('links a signed-in account to its profile, marked current on it', () => {
    renderWithProviders(<NavigationLinks activePath="/me" />)

    const profile = screen.getByTestId('app-shell.nav.profile-link')

    expect(profile.getAttribute('href')).toBe('/me')
    expect(profile.getAttribute('aria-current')).toBe('page')
    expect(profile.textContent).toBe(en['app.shell.nav.profile'])
  })

  it('links a signed-in user to the organisation page', () => {
    renderWithProviders(<NavigationLinks activePath="/org" />)

    const organisation = screen.getByTestId('app-shell.nav.organisation-link')

    expect(organisation.getAttribute('href')).toBe('/org')
    expect(organisation.getAttribute('aria-current')).toBe('page')
    expect(organisation.textContent).toBe(en['app.shell.nav.organisation'])
    expect(screen.getByTestId('app-shell.nav.profile-link').getAttribute('aria-current')).toBeNull()
  })

  it('links a signed-in user to their devices', () => {
    renderWithProviders(<NavigationLinks activePath="/devices" />)

    const devices = screen.getByTestId('app-shell.nav.devices-link')

    expect(devices.getAttribute('href')).toBe('/devices')
    expect(devices.getAttribute('aria-current')).toBe('page')
    expect(devices.textContent).toBe(en['app.shell.nav.devices'])
  })

  it('draws each link with the link it is given', () => {
    const RoutedLink = ({ to, ...props }: ShellLinkProps) => (
      <a href={`/app${to}`} data-routed="yes" {...props} />
    )

    renderWithProviders(<NavigationLinks link={RoutedLink} activePath="/settings" />)

    const settings = screen.getByTestId('app-shell.nav.settings-link')

    expect(settings.getAttribute('href')).toBe('/app/settings')
    expect(settings.getAttribute('data-routed')).toBe('yes')
    expect(settings.getAttribute('aria-current')).toBe('page')
  })
})
