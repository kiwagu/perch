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
    renderShell({ notice: { code: 'profile-saved', text: 'Saved' } })

    const notice = screen.getByTestId('app-shell.notice-message')

    expect(notice.getAttribute('data-code')).toBe('profile-saved')
    expect(notice.textContent).toBe('Saved')
    expect(notice.getAttribute('role')).toBe('status')
  })

  it('marks the navigation and the language select', () => {
    renderShell({ signedIn: true, activePath: '/me' })

    const navigation = screen.getByTestId('app-shell.nav')

    expect(navigation.tagName).toBe('NAV')
    expect(within(navigation).getByTestId('app-shell.nav.profile-link')).toBeTruthy()
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
          notice={{ code: 'welcome', text: 'Welcome' }}
        >
          <p>page</p>
        </ShellView>
      </I18nProvider>,
    )

    expect(container.querySelector('[data-slot="notice"]')).toBe(slot)
    expect(slot?.contains(screen.getByTestId('app-shell.notice-message'))).toBe(true)
  })
})
