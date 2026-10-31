// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
        canChooseLocale={true}
        onLocaleChange={() => {}}
        theme="system"
        canChooseTheme={true}
        onThemeChange={() => {}}
        {...rest}
      >
        <p>page</p>
      </ShellView>
    </I18nProvider>,
  )
}

describe('ShellView', () => {
  it('says the app is ready in one status line and shows the page once the database is open', () => {
    renderShell()

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('ready')
    expect(status.textContent).toBe(en['app.shell.sync.local'])
    expect(status.className).toContain('sr-only')
    expect(screen.getByText('page')).toBeTruthy()
  })

  it('tells the user the database is opening and holds the page back', () => {
    renderShell({ status: 'opening' })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('opening')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe(en['app.shell.opening-db'])
    expect(screen.queryByText('page')).toBeNull()
  })

  it('says the browser keeps no site data when it blocks storage, and holds the page back', () => {
    renderShell({ status: 'storage-blocked' })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('storage-blocked')
    expect(status.textContent).toBe(en['app.shell.storage-blocked'])
    expect(screen.queryByText('page')).toBeNull()
  })

  it('offers to sign out on this device when it could not open its data', () => {
    const signOutHere = vi.fn()

    renderShell({ status: 'failed', onSignOutHere: signOutHere })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('failed')
    expect(status.textContent).toBe(en['app.shell.failed'])

    const button = screen.getByTestId('app-shell.sign-out-here-button')

    expect(button.textContent).toBe(en['app.shell.sign-out-here'])
    fireEvent.click(button)
    expect(signOutHere).toHaveBeenCalledOnce()
  })

  it('holds the button while the sign-out runs, and offers none without a way out', () => {
    const { unmount } = renderShell({
      status: 'failed',
      onSignOutHere: () => {},
      signingOutHere: true,
    })

    expect(screen.getByTestId('app-shell.sign-out-here-button').hasAttribute('disabled')).toBe(true)
    unmount()

    renderShell({ status: 'failed' })

    expect(screen.queryByTestId('app-shell.sign-out-here-button')).toBeNull()
  })

  it('links to sign-in when signed out and to the profile when signed in', () => {
    const { unmount } = renderShell()
    const signedOut = screen.getAllByTestId('app-shell.nav.sign-in-link')

    expect(signedOut[0]?.getAttribute('href')).toBe('/sign-in')
    expect(signedOut[0]?.getAttribute('aria-current')).toBe('page')
    unmount()

    renderShell({ signedIn: true, activePath: '/me' })

    expect(screen.getAllByTestId('app-shell.nav.profile-link')[0]?.getAttribute('href')).toBe('/me')
    expect(screen.queryByTestId('app-shell.nav.sign-in-link')).toBeNull()
  })

  it('links a signed-in user to the organisation page', () => {
    renderShell({ signedIn: true, activePath: '/org' })

    const organisation = screen.getAllByTestId('app-shell.nav.organisation-link')[0] as HTMLElement

    expect(organisation.getAttribute('href')).toBe('/org')
    expect(organisation.getAttribute('aria-current')).toBe('page')
    expect(organisation.textContent).toBe(en['app.shell.nav.organisation'])
    expect(
      screen.getAllByTestId('app-shell.nav.profile-link')[0]?.getAttribute('aria-current'),
    ).toBeNull()
  })

  it('links a signed-in user to their devices, and nobody else', () => {
    const { unmount } = renderShell()

    expect(screen.queryByTestId('app-shell.nav.devices-link')).toBeNull()
    unmount()

    renderShell({ signedIn: true, activePath: '/devices' })

    const devices = screen.getAllByTestId('app-shell.nav.devices-link')[0] as HTMLElement

    expect(devices.getAttribute('href')).toBe('/devices')
    expect(devices.getAttribute('aria-current')).toBe('page')
    expect(devices.textContent).toBe(en['app.shell.nav.devices'])
  })

  it('announces the current notice with its code', () => {
    renderShell({ notice: { code: 'welcome', text: 'Welcome' } })

    const notice = screen.getByTestId('app-shell.notice-message')

    expect(notice.getAttribute('data-code')).toBe('welcome')
    expect(notice.textContent).toBe('Welcome')
    expect(notice.getAttribute('role')).toBe('status')
  })

  it("marks a signed-in account's navigation, settings included, with no language select", () => {
    renderShell({ signedIn: true, activePath: '/me' })

    const navigation = screen.getByTestId('app-shell.nav')

    expect(navigation.tagName).toBe('NAV')
    expect(within(navigation).getByTestId('app-shell.nav.profile-link')).toBeTruthy()
    expect(within(navigation).getByTestId('app-shell.nav.settings-link')).toBeTruthy()
    // The settings screen takes a signed-in account's language.
    expect(screen.queryByTestId('app-shell.locale-select')).toBeNull()
  })

  it("shows anyone the device's theme, a guest and a signed-in account alike", () => {
    const { unmount } = renderShell({ theme: 'dark' })
    const select = screen.getByTestId('app-shell.theme-select')

    expect(select.getAttribute('role')).toBe('combobox')
    expect(select.getAttribute('data-value')).toBe('dark')
    unmount()

    renderShell({ signedIn: true, activePath: '/me', theme: 'light' })

    expect(screen.getByTestId('app-shell.theme-select').getAttribute('data-value')).toBe('light')
  })

  it('takes a theme choice only while the frame takes one', () => {
    renderShell({ canChooseTheme: false })

    expect(screen.getByTestId('app-shell.theme-select').hasAttribute('data-disabled')).toBe(true)
  })

  it("marks a guest's language select", () => {
    renderShell({ signedIn: false })

    expect(screen.getByTestId('app-shell.locale-select').getAttribute('role')).toBe('combobox')
  })

  it('takes a language choice only while the frame takes one', () => {
    const { rerender } = renderShell({ canChooseLocale: false })
    const select = screen.getByTestId('app-shell.locale-select')

    expect(select.hasAttribute('data-disabled')).toBe(true)

    rerender(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ShellView
          status="ready"
          signedIn={false}
          activePath="/sign-in"
          canChooseLocale
          onLocaleChange={() => {}}
          theme="system"
          canChooseTheme
          onThemeChange={() => {}}
        >
          <p>page</p>
        </ShellView>
      </I18nProvider>,
    )

    expect(screen.getByTestId('app-shell.locale-select').hasAttribute('data-disabled')).toBe(false)
  })

  it('speaks Spanish when the Spanish catalog is chosen', () => {
    renderShell({ locale: 'es' })

    const navigation = screen.getAllByTestId('app-shell.nav.sign-in-link')[0] as HTMLElement

    expect(within(navigation).getByText(es['app.shell.nav.sign-in'])).toBeTruthy()
    expect(screen.getByText(es['app.shell.title'])).toBeTruthy()
  })

  it('renders the toasts, newest first, each dismissed by a click', () => {
    const onDismissToast = vi.fn()

    renderShell({
      toasts: [
        { id: 2, code: 'note-updated', tone: 'success', text: 'Note saved.' },
        { id: 1, code: 'note-created', tone: 'success', text: 'Note added.' },
      ],
      onDismissToast,
    })

    const toasts = screen.getAllByTestId('app-shell.toast')

    expect(toasts.map((toast) => toast.getAttribute('data-code'))).toEqual([
      'note-updated',
      'note-created',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Note saved.' }))

    expect(onDismissToast).toHaveBeenCalledWith(2)
  })

  it('draws each toast in its tone', () => {
    renderShell({ toasts: [{ id: 1, code: 'note-lost', tone: 'error', text: 'Note lost.' }] })

    const icon = screen.getByRole('button', { name: 'Note lost.' }).querySelector('svg')

    expect(icon?.getAttribute('class')).toContain('lucide-circle-x')
  })

  it("keeps the notice's line while there is no notice, so the page does not move", () => {
    const { container, rerender } = renderShell()
    const slot = container.querySelector('[data-slot="notice"]')

    expect(slot).not.toBeNull()
    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()

    rerender(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ShellView
          status="ready"
          signedIn={false}
          activePath="/sign-in"
          canChooseLocale={true}
          onLocaleChange={() => {}}
          theme="system"
          canChooseTheme={true}
          onThemeChange={() => {}}
          notice={{ code: 'welcome', text: 'Welcome' }}
        >
          <p>page</p>
        </ShellView>
      </I18nProvider>,
    )

    expect(container.querySelector('[data-slot="notice"]')).toBe(slot)
    expect(slot?.contains(screen.getByTestId('app-shell.notice-message'))).toBe(true)
  })

  it('says a screen failed to render, in its place, with a reload while the flow takes one', () => {
    const onReload = vi.fn()
    const { rerender } = renderShell({ crash: 'screen-crashed', canReload: true, onReload })
    const message = screen.getByTestId('app-shell.crash-message')

    expect(message.getAttribute('data-code')).toBe('screen-crashed')
    expect(message.textContent).toBe(en['app.shell.crash.screen-crashed'])
    expect(screen.getByTestId('app-shell.nav')).toBeTruthy()

    fireEvent.click(screen.getByTestId('app-shell.reload-button'))

    expect(onReload).toHaveBeenCalledOnce()

    rerender(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ShellView
          status="ready"
          signedIn={false}
          activePath="/sign-in"
          canChooseLocale={true}
          onLocaleChange={() => {}}
          theme="system"
          canChooseTheme={true}
          onThemeChange={() => {}}
          crash="screen-crashed"
          canReload={false}
          onReload={onReload}
        >
          <p>page</p>
        </ShellView>
      </I18nProvider>,
    )

    expect(screen.getByTestId('app-shell.reload-button').hasAttribute('disabled')).toBe(true)
  })

  it('shows no crash message or reload while the screen renders', () => {
    renderShell()

    expect(screen.queryByTestId('app-shell.crash-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.reload-button')).toBeNull()
  })

  it('says a newer build is served, above the page, with a reload while the flow takes one', () => {
    const onUpdate = vi.fn()

    renderShell({ update: 'new-version', canUpdate: true, onUpdate })

    const message = screen.getByTestId('app-shell.update-message')

    expect(message.getAttribute('data-code')).toBe('new-version')
    expect(message.textContent).toBe(en['app.shell.update.new-version'])
    expect(screen.getByText('page')).toBeTruthy()

    fireEvent.click(screen.getByTestId('app-shell.update-button'))

    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('says a protocol the server no longer takes, its reload held while the flow takes none', () => {
    renderShell({ update: 'protocol-outdated', canUpdate: false, onUpdate: () => {}, locale: 'es' })

    const message = screen.getByTestId('app-shell.update-message')

    expect(message.getAttribute('data-code')).toBe('protocol-outdated')
    expect(message.textContent).toBe(es['app.shell.update.protocol-outdated'])
    expect(screen.getByTestId('app-shell.update-button').hasAttribute('disabled')).toBe(true)
  })

  it('shows no update message or its reload before an update', () => {
    renderShell()

    expect(screen.queryByTestId('app-shell.update-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.update-button')).toBeNull()
  })

  it("says the state of this device's sync in the header, in the language the app speaks", () => {
    renderShell({ signedIn: true, activePath: '/me', sync: 'offline', locale: 'es' })

    const sync = screen.getByTestId('app-shell.sync-message')

    expect(sync.getAttribute('data-code')).toBe('offline')
    expect(sync.getAttribute('role')).toBe('status')
    expect(sync.textContent).toBe(es['app.shell.sync.offline'])
  })

  it('shows no state of the sync without one, as for a guest', () => {
    renderShell()

    expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()
  })

  it('reminds to install the app with its button and later, each while the flow takes it', () => {
    const onInstall = vi.fn()
    const onPostponeInstall = vi.fn()

    renderShell({
      install: 'install-available',
      canInstall: true,
      onInstall,
      canPostponeInstall: true,
      onPostponeInstall,
    })

    const message = screen.getByTestId('app-shell.install-message')

    expect(message.getAttribute('data-code')).toBe('install-available')
    expect(message.textContent).toBe(en['app.shell.install.available'])

    fireEvent.click(screen.getByTestId('app-shell.install-button'))
    fireEvent.click(screen.getByTestId('app-shell.install-later-button'))

    expect(onInstall).toHaveBeenCalledOnce()
    expect(onPostponeInstall).toHaveBeenCalledOnce()
  })

  it('shows the steps that install the app with later and no install button, in Spanish too', () => {
    renderShell({ install: 'install-by-steps', canPostponeInstall: false, locale: 'es' })

    expect(screen.getByTestId('app-shell.install-message').textContent).toBe(
      es['app.shell.install.by-steps'],
    )
    expect(screen.queryByTestId('app-shell.install-button')).toBeNull()
    expect(screen.getByTestId('app-shell.install-later-button').hasAttribute('disabled')).toBe(true)
  })
})
