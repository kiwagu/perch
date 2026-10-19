// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider, type Locale } from '@workspace/i18n'

import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'

import { ShellView, type ShellViewProps } from './shell.view'

function renderShell(props: Partial<ShellViewProps> & { readonly locale?: Locale } = {}) {
  const { locale = 'en', ...rest } = props

  return render(
    <I18nProvider locale={locale} catalogs={{ en, es }}>
      <ShellView
        status="ready"
        signedIn={false}
        activePath="/sign-in"
        onLocaleChange={() => {}}
        {...rest}
      >
        <p>page</p>
      </ShellView>
    </I18nProvider>,
  )
}

describe('ShellView', () => {
  it('shows a ready marker and the page once the database is open', () => {
    renderShell()

    expect(screen.getByTestId('app-shell.ready')).toBeTruthy()
    expect(screen.getByText('page')).toBeTruthy()
  })

  it('tells the user the database is opening and holds the page back', () => {
    renderShell({ status: 'opening' })

    expect(screen.getByTestId('app-shell.opening').textContent).toBe(en['app.shell.opening-db'])
    expect(screen.queryByTestId('app-shell.ready')).toBeNull()
    expect(screen.queryByText('page')).toBeNull()
  })

  it('links to sign-in when signed out and to the profile when signed in', () => {
    const { unmount } = renderShell()
    const signedOut = screen.getAllByTestId('app-shell.nav.sign-in')

    expect(signedOut[0]?.getAttribute('href')).toBe('/sign-in')
    expect(signedOut[0]?.getAttribute('aria-current')).toBe('page')
    unmount()

    renderShell({ signedIn: true, activePath: '/me' })

    expect(screen.getAllByTestId('app-shell.nav.profile')[0]?.getAttribute('href')).toBe('/me')
    expect(screen.queryByTestId('app-shell.nav.sign-in')).toBeNull()
  })

  it('links a signed-in user to the organisation page', () => {
    renderShell({ signedIn: true, activePath: '/org' })

    const organisation = screen.getAllByTestId('app-shell.nav.organisation')[0] as HTMLElement

    expect(organisation.getAttribute('href')).toBe('/org')
    expect(organisation.getAttribute('aria-current')).toBe('page')
    expect(organisation.textContent).toBe(en['app.shell.nav.organisation'])
    expect(
      screen.getAllByTestId('app-shell.nav.profile')[0]?.getAttribute('aria-current'),
    ).toBeNull()
  })

  it('links a signed-in user to their devices, and nobody else', () => {
    const { unmount } = renderShell()

    expect(screen.queryByTestId('app-shell.nav.devices')).toBeNull()
    unmount()

    renderShell({ signedIn: true, activePath: '/devices' })

    const devices = screen.getAllByTestId('app-shell.nav.devices')[0] as HTMLElement

    expect(devices.getAttribute('href')).toBe('/devices')
    expect(devices.getAttribute('aria-current')).toBe('page')
    expect(devices.textContent).toBe(en['app.shell.nav.devices'])
  })

  it('announces the current notice', () => {
    renderShell({ notice: { testId: 'user.profile.notice', text: 'Saved' } })

    const notice = screen.getByTestId('user.profile.notice')

    expect(notice.textContent).toBe('Saved')
    expect(notice.getAttribute('role')).toBe('status')
  })

  it('speaks Spanish when the Spanish catalog is chosen', () => {
    renderShell({ locale: 'es' })

    const navigation = screen.getAllByTestId('app-shell.nav.sign-in')[0] as HTMLElement

    expect(within(navigation).getByText(es['app.shell.nav.sign-in'])).toBeTruthy()
    expect(screen.getByText(es['app.shell.title'])).toBeTruthy()
  })
})
