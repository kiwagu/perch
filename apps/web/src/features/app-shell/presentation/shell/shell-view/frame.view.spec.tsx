// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Locale } from '@workspace/i18n'
import { heldRoles } from '@workspace/ui-contract/anchors'

import en from '../../../../../platform/i18n/app.en.json'
import es from '../../../../../platform/i18n/app.es.json'
import { renderWithProviders } from '../../../../../test-utils'

import { type ShellListed, ShellView, type ShellViewProps } from './frame.view'

/** What a state of the frame's flow renders of the anchors only some render: `anchors` alone. */
const rendering =
  (...anchors: readonly ShellListed[]) =>
  (anchor: ShellListed) =>
    anchors.includes(anchor)

/** The frame ready, as most of its states: the navigation of a signed-in account. */
const READY = rendering('app-shell.nav')

/** The roles of a guest's device, and of a signed-in account's with no other role. */
const GUEST = heldRoles(false)
const ACCOUNT = heldRoles(true)

/** A guest's frame, ready, around a page, with `props` over it. */
const shell = (props: Partial<ShellViewProps> = {}) => (
  <ShellView
    status="ready"
    renders={READY}
    held={GUEST}
    activePath="/sign-in"
    canChooseLocale={true}
    onLocaleChange={() => {}}
    theme="system"
    canChooseTheme={true}
    onThemeChange={() => {}}
    {...props}
  >
    <p>page</p>
  </ShellView>
)

function renderShell(props: Partial<ShellViewProps> & { readonly locale?: Locale } = {}) {
  const { locale = 'en', ...rest } = props

  return renderWithProviders(shell(rest), { locale, es })
}

describe('ShellView', () => {
  it.each([
    ['opening', false],
    ['opening-data', true],
    ['ready', true],
    ['failed', false],
    ['start-failed', false],
    ['storage-blocked', false],
  ] as const)(
    'says where the start is in its status line (%s), the page shown: %s',
    (status, shown) => {
      renderShell({ status, renders: rendering() })

      expect(screen.getByTestId('app-shell.status').getAttribute('data-state')).toBe(status)
      expect(screen.queryByText('page') !== null).toBe(shown)
    },
  )

  it("shows a signed-in account's navigation and screen while its data opens, but no message of the platform", () => {
    renderShell({
      status: 'opening-data',
      held: ACCOUNT,
      sync: 'synced',
      update: 'new-version',
      install: 'install-available',
      notice: { code: 'devices-read-failed', text: 'The devices could not be read.' },
      toasts: [{ id: 1, code: 'password-changed', tone: 'success', text: 'Password changed.' }],
    })

    expect(screen.getByText('page')).toBeTruthy()
    expect(screen.getByTestId('app-shell.nav.profile-link')).toBeTruthy()
    // No message of the platform shows before the data is open; a toast shows at once.
    expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.update-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.install-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()
    expect(screen.getByTestId('app-shell.toast').getAttribute('data-code')).toBe('password-changed')
  })

  it('shows the messages of the platform once ready, the update and the install above the page', () => {
    renderShell({
      held: ACCOUNT,
      activePath: '/me',
      sync: 'synced',
      update: 'new-version',
      install: 'install-available',
      notice: { code: 'welcome', text: 'Welcome' },
    })

    const page = screen.getByText('page')
    const above = (testId: string) =>
      screen.getByTestId(testId).compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING

    expect(screen.getByTestId('app-shell.sync-message').getAttribute('data-code')).toBe('synced')
    expect(screen.getByTestId('app-shell.notice-message').getAttribute('data-code')).toBe('welcome')
    expect(above('app-shell.update-message')).toBeTruthy()
    expect(above('app-shell.install-message')).toBeTruthy()
  })

  it.each([
    ['offers to sign out on this device where the state renders it', true, true, true],
    ['offers no sign-out without a way out', true, false, false],
    [
      'offers no sign-out where the state renders none, as when the app could not start',
      false,
      true,
      false,
    ],
  ])('%s', (_, rendered, wayOut, shown) => {
    renderShell({
      status: rendered ? 'failed' : 'start-failed',
      renders: rendered ? rendering('app-shell.sign-out-here-button') : rendering(),
      onSignOutHere: wayOut ? () => {} : undefined,
    })

    expect(screen.queryByTestId('app-shell.sign-out-here-button') !== null).toBe(shown)
  })

  it('shows a guest no navigation, only the banner and the page', () => {
    renderShell({ held: GUEST, activePath: '/sign-in' })

    expect(screen.queryByTestId('app-shell.nav')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(en['app.shell.title'])).toBeTruthy()
    expect(screen.getByTestId('app-shell.theme-select')).toBeTruthy()
    expect(screen.getByTestId('app-shell.locale-select')).toBeTruthy()
    expect(screen.getByText('page')).toBeTruthy()
  })

  it("shows a signed-in account no navigation where the frame's state renders none", () => {
    renderShell({ held: ACCOUNT, activePath: '/me', renders: rendering() })

    expect(screen.queryByTestId('app-shell.nav')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it("marks a signed-in account's navigation, its four links in it, with no language select", () => {
    renderShell({ held: ACCOUNT, activePath: '/me' })

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

  it("adds the console's link to an operator's navigation, and to nobody else's", () => {
    renderShell({ held: heldRoles(true, ['admin', 'operator']), activePath: '/me' })

    const navigation = screen.getByTestId('app-shell.nav')

    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-testid')),
    ).toEqual([
      'app-shell.nav.profile-link',
      'app-shell.nav.organisation-link',
      'app-shell.nav.devices-link',
      'app-shell.nav.settings-link',
      'app-shell.nav.console-link',
    ])
  })

  it('speaks Spanish when the Spanish catalog is chosen', () => {
    renderShell({ locale: 'es', held: ACCOUNT, activePath: '/me' })

    const navigation = screen.getByTestId('app-shell.nav')

    expect(navigation.getAttribute('aria-label')).toBe(es['app.shell.navigation'])
    expect(screen.getByTestId('app-shell.nav.profile-link').textContent).toBe(
      es['app.shell.nav.profile'],
    )
    expect(screen.getByText(es['app.shell.title'])).toBeTruthy()
  })

  it('says a screen failed to render in its place, the frame around it', () => {
    renderShell({
      crash: 'screen-crashed',
      renders: rendering('app-shell.nav', 'app-shell.reload-button'),
      canReload: true,
      onReload: () => {},
    })

    expect(screen.getByTestId('app-shell.crash-message').getAttribute('data-code')).toBe(
      'screen-crashed',
    )
    expect(screen.getByTestId('app-shell.reload-button')).toBeTruthy()
    // The frame stays around it: a guest's theme and language selects.
    expect(screen.getByTestId('app-shell.theme-select')).toBeTruthy()
    expect(screen.getByTestId('app-shell.locale-select')).toBeTruthy()
  })

  it('shows no crash message or reload while the screen renders', () => {
    renderShell()

    expect(screen.queryByTestId('app-shell.crash-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.reload-button')).toBeNull()
  })

  it('shows no update message or its reload before an update', () => {
    renderShell()

    expect(screen.queryByTestId('app-shell.update-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.update-button')).toBeNull()
  })
})
