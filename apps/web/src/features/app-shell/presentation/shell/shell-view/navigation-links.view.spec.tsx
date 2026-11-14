// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { heldRoles } from '@workspace/ui-contract/anchors'

import en from '../../../../../platform/i18n/app.en.json'
import es from '../../../../../platform/i18n/app.es.json'
import { renderWithProviders } from '../../../../../test-utils'

import { NavigationLinks, type ShellLinkProps } from './navigation-links.view'

/** A signed-in account's roles with no organisation and no role of the platform. */
const ACCOUNT = heldRoles(true)

/** The links of the navigation drawn, by their anchors, in order. */
const links = () =>
  screen.getAllByRole('link').map((link) => link.getAttribute('data-testid') ?? '(none)')

describe('NavigationLinks', () => {
  it('links a signed-in account to its profile, marked current on it', () => {
    renderWithProviders(<NavigationLinks activePath="/me" held={ACCOUNT} />)

    const profile = screen.getByTestId('app-shell.nav.profile-link')

    expect(profile.getAttribute('href')).toBe('/me')
    expect(profile.getAttribute('aria-current')).toBe('page')
    expect(profile.textContent).toBe(en['app.shell.nav.profile'])
  })

  it('links a signed-in user to the organisation page', () => {
    renderWithProviders(<NavigationLinks activePath="/org" held={ACCOUNT} />)

    const organisation = screen.getByTestId('app-shell.nav.organisation-link')

    expect(organisation.getAttribute('href')).toBe('/org')
    expect(organisation.getAttribute('aria-current')).toBe('page')
    expect(organisation.textContent).toBe(en['app.shell.nav.organisation'])
    expect(screen.getByTestId('app-shell.nav.profile-link').getAttribute('aria-current')).toBeNull()
  })

  it('links a signed-in user to their devices', () => {
    renderWithProviders(<NavigationLinks activePath="/devices" held={ACCOUNT} />)

    const devices = screen.getByTestId('app-shell.nav.devices-link')

    expect(devices.getAttribute('href')).toBe('/devices')
    expect(devices.getAttribute('aria-current')).toBe('page')
    expect(devices.textContent).toBe(en['app.shell.nav.devices'])
  })

  it('draws each link with the link it is given', () => {
    const RoutedLink = ({ to, ...props }: ShellLinkProps) => (
      <a href={`/app${to}`} data-routed="yes" {...props} />
    )

    renderWithProviders(<NavigationLinks link={RoutedLink} activePath="/settings" held={ACCOUNT} />)

    const settings = screen.getByTestId('app-shell.nav.settings-link')

    expect(settings.getAttribute('href')).toBe('/app/settings')
    expect(settings.getAttribute('data-routed')).toBe('yes')
    expect(settings.getAttribute('aria-current')).toBe('page')
  })

  it('links an operator to the console as well, marked current on it, in the language the app speaks', () => {
    renderWithProviders(
      <NavigationLinks activePath="/console/users" held={heldRoles(true, ['operator'])} />,
      { locale: 'es', es },
    )

    const consoleLink = screen.getByTestId('app-shell.nav.console-link')

    expect(consoleLink.getAttribute('href')).toBe('/console/users')
    expect(consoleLink.getAttribute('aria-current')).toBe('page')
    expect(consoleLink.textContent).toBe(es['app.shell.nav.console'])
    expect(links()).toEqual([
      'app-shell.nav.profile-link',
      'app-shell.nav.organisation-link',
      'app-shell.nav.devices-link',
      'app-shell.nav.settings-link',
      'app-shell.nav.console-link',
    ])
  })

  it('shows no console link to an account that is no operator, an organisation admin included', () => {
    for (const held of [ACCOUNT, heldRoles(true, ['member']), heldRoles(true, ['admin'])]) {
      const { unmount } = renderWithProviders(<NavigationLinks activePath="/me" held={held} />)

      expect(screen.queryByTestId('app-shell.nav.console-link')).toBeNull()
      expect(links()).toEqual([
        'app-shell.nav.profile-link',
        'app-shell.nav.organisation-link',
        'app-shell.nav.devices-link',
        'app-shell.nav.settings-link',
      ])
      unmount()
    }
  })
})
