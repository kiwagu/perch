// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider, type Locale } from '@workspace/i18n'

import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'

import { type ShellListed, ShellView, type ShellViewProps } from './shell.view'

/** What a state of the frame's flow renders of the anchors only some render: `anchors` alone. */
const rendering =
  (...anchors: readonly ShellListed[]) =>
  (anchor: ShellListed) =>
    anchors.includes(anchor)

/** The frame ready, as most of its states: the navigation of a signed-in account. */
const READY = rendering('app-shell.nav')

function renderShell(props: Partial<ShellViewProps> & { readonly locale?: Locale } = {}) {
  const { locale = 'en', ...rest } = props

  return render(
    <I18nProvider locale={locale} catalogs={{ en, es }}>
      <ShellView
        status="ready"
        renders={READY}
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

  it('tells the user the app is starting and holds the page back', () => {
    renderShell({ status: 'opening' })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('opening')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe(en['app.shell.starting'])
    expect(screen.queryByText('page')).toBeNull()
  })

  it("shows a signed-in account's navigation and screen while its data opens, saying so", () => {
    renderShell({ status: 'opening-data', signedIn: true, sync: 'synced', update: 'new-version' })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('opening-data')
    expect(status.textContent).toBe(en['app.shell.opening-db'])
    expect(status.className).not.toContain('sr-only')
    expect(screen.getByText('page')).toBeTruthy()
    expect(screen.getByTestId('app-shell.nav.profile-link')).toBeTruthy()
    // No message of the platform shows before the data is open.
    expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.update-message')).toBeNull()
  })

  it("shows no notice while a signed-in account's data opens, but its toasts at once", () => {
    renderShell({
      status: 'opening-data',
      signedIn: true,
      notice: { code: 'devices-read-failed', text: 'The devices could not be read.' },
      toasts: [{ id: 1, code: 'password-changed', tone: 'success', text: 'Password changed.' }],
    })

    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()
    expect(screen.getByTestId('app-shell.toast').getAttribute('data-code')).toBe('password-changed')
  })

  it('says the app could not start, holds the page back and offers no sign-out', () => {
    renderShell({ status: 'start-failed', renders: rendering(), onSignOutHere: () => {} })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('start-failed')
    expect(status.textContent).toBe(en['app.shell.start-failed'])
    expect(screen.queryByText('page')).toBeNull()
    expect(screen.queryByTestId('app-shell.sign-out-here-button')).toBeNull()
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

    renderShell({
      status: 'failed',
      renders: rendering('app-shell.sign-out-here-button'),
      onSignOutHere: signOutHere,
    })

    const status = screen.getByTestId('app-shell.status')

    expect(status.getAttribute('data-state')).toBe('failed')
    expect(status.textContent).toBe(en['app.shell.failed'])

    const button = screen.getByTestId('app-shell.sign-out-here-button')

    expect(button.textContent).toBe(en['app.shell.sign-out-here'])
    fireEvent.click(button)
    expect(signOutHere).toHaveBeenCalledOnce()
  })

  it('holds the button while the sign-out runs, and offers none without a way out', () => {
    const failed = rendering('app-shell.sign-out-here-button')
    const { unmount } = renderShell({
      status: 'failed',
      renders: failed,
      onSignOutHere: () => {},
      signingOutHere: true,
    })

    expect(screen.getByTestId('app-shell.sign-out-here-button').hasAttribute('disabled')).toBe(true)
    unmount()

    renderShell({ status: 'failed', renders: failed })

    expect(screen.queryByTestId('app-shell.sign-out-here-button')).toBeNull()
  })

  it('shows a guest no navigation, only the banner and the page', () => {
    renderShell({ signedIn: false, activePath: '/sign-in' })

    expect(screen.queryByTestId('app-shell.nav')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(en['app.shell.title'])).toBeTruthy()
    expect(screen.getByTestId('app-shell.theme-select')).toBeTruthy()
    expect(screen.getByTestId('app-shell.locale-select')).toBeTruthy()
    expect(screen.getByText('page')).toBeTruthy()
  })

  it('links a signed-in account to its profile, marked current on it', () => {
    renderShell({ signedIn: true, activePath: '/me' })

    const profile = screen.getByTestId('app-shell.nav.profile-link')

    expect(profile.getAttribute('href')).toBe('/me')
    expect(profile.getAttribute('aria-current')).toBe('page')
    expect(profile.textContent).toBe(en['app.shell.nav.profile'])
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

  it("marks a signed-in account's navigation, its four links in it, with no language select", () => {
    renderShell({ signedIn: true, activePath: '/me' })

    const navigation = screen.getByTestId('app-shell.nav')

    expect(navigation.tagName).toBe('NAV')
    expect(navigation.getAttribute('aria-label')).toBe(en['app.shell.navigation'])
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-testid')),
    ).toEqual([
      'app-shell.nav.profile-link',
      'app-shell.nav.organisation-link',
      'app-shell.nav.devices-link',
      'app-shell.nav.settings-link',
    ])
    // The settings screen takes a signed-in account's language and theme.
    expect(screen.queryByTestId('app-shell.locale-select')).toBeNull()
    expect(screen.queryByTestId('app-shell.theme-select')).toBeNull()
  })

  it("shows a guest the device's theme, and a signed-in account no theme select", () => {
    const { unmount } = renderShell({ theme: 'dark' })
    const select = screen.getByTestId('app-shell.theme-select')

    expect(select.getAttribute('role')).toBe('combobox')
    expect(select.getAttribute('data-value')).toBe('dark')
    unmount()

    renderShell({ signedIn: true, activePath: '/me', theme: 'light' })

    expect(screen.queryByTestId('app-shell.theme-select')).toBeNull()
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
          renders={READY}
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
    renderShell({ locale: 'es', signedIn: true, activePath: '/me' })

    const navigation = screen.getByTestId('app-shell.nav')

    expect(navigation.getAttribute('aria-label')).toBe(es['app.shell.navigation'])
    expect(screen.getByTestId('app-shell.nav.profile-link').textContent).toBe(
      es['app.shell.nav.profile'],
    )
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
          renders={READY}
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
    const crashed = rendering('app-shell.nav', 'app-shell.reload-button')
    const { rerender } = renderShell({
      crash: 'screen-crashed',
      renders: crashed,
      canReload: true,
      onReload,
    })
    const message = screen.getByTestId('app-shell.crash-message')

    expect(message.getAttribute('data-code')).toBe('screen-crashed')
    expect(message.textContent).toBe(en['app.shell.crash.screen-crashed'])
    // The frame stays around it: a guest's theme and language selects.
    expect(screen.getByTestId('app-shell.theme-select')).toBeTruthy()
    expect(screen.getByTestId('app-shell.locale-select')).toBeTruthy()

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
          renders={crashed}
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
