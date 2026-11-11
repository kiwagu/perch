// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { bart, opal, una } from '../../../../../platform/__fixtures__/accounts'
import type { AccountCard } from '../../../../../platform/accounts.port'
import { renderWithProviders } from '../../../../../test-utils'
import type { AccountEvent } from '../../../application/account-machine/machine'
import en from '../../i18n/console.en.json'
import es from '../../i18n/console.es.json'

import { AccountView, type AccountViewProps } from './account.view'

const at = (when: string) => new Date(when)

/** Una's card: a profile, never verified, seen once, a member of one organisation. */
const unaCard: AccountCard = {
  ...una,
  hasProfile: true,
  lastSeenAt: at('2026-10-18T09:30:00.000Z'),
  organisations: [
    { key: 'acme', name: 'Acme', role: 'admin' },
    { key: 'beta', name: 'Beta', role: 'member' },
  ],
}

/** Bart's card: banned with a reason, verified, no profile yet, never seen, in no organisation. */
const bartCard: AccountCard = {
  ...bart,
  hasProfile: false,
  banReason: 'spam',
  organisations: [],
}

/** Opal's card: an operator, verified, with a profile. */
const opalCard: AccountCard = { ...opal, hasProfile: true, organisations: [] }

type Areas = NonNullable<AccountViewProps['areas']>

/**
 * The card over Una's account with `props`, its areas holding `areas`, every control enabled.
 */
function renderView(
  props: Partial<Omit<AccountViewProps, 'areas'>> & Partial<Areas> = {},
  locale: 'en' | 'es' = 'en',
) {
  const handlers = {
    onName: vi.fn(),
    onEmail: vi.fn(),
    onReason: vi.fn(),
    onAct: vi.fn((_: AccountEvent) => Promise.resolve(true)),
  }
  const { account: given, failure, ...areas } = props
  // An account left out is Una's; one given as undefined is being read.
  const account = 'account' in props ? given : unaCard

  renderWithProviders(
    <AccountView
      account={account}
      failure={failure}
      areas={{
        errors: {},
        name: account?.name ?? '',
        email: '',
        reason: '',
        can: () => true,
        ...handlers,
        ...areas,
      }}
    />,
    { locale, es },
  )

  return handlers
}

const byId = <E extends HTMLElement = HTMLElement>(id: string) => screen.getByTestId<E>(id)
const shown = (id: string) => screen.queryByTestId(id) !== null

describe('AccountView', () => {
  it('leads back to the accounts in every state, a touch target', () => {
    renderView({ account: undefined })

    const back = byId('console.account.back-link')

    expect(back.getAttribute('href')).toBe('/console/users')
    expect(back.textContent).toBe(en['console.account.back'])
    expect(back.className).toMatch(/min-h-11/)
    expect(back.className).toMatch(/min-w-11/)
  })

  it('shows the section loading while the account is read, with nothing of it', () => {
    renderView({ account: undefined })

    expect(byId('console.account.section').getAttribute('data-state')).toBe('loading')
    expect(shown('console.account.heading')).toBe(false)
    expect(shown('console.account.email-cell')).toBe(false)
    expect(shown('console.account.name.form')).toBe(false)
    expect(shown('console.account.error')).toBe(false)
  })

  it('names the account in its heading and shows its email, dates and marks once read', () => {
    renderView()

    expect(byId('console.account.section').getAttribute('data-state')).toBe('ready')
    expect(screen.getByRole('heading', { level: 1 })).toBe(byId('console.account.heading'))
    expect(byId('console.account.heading').textContent).toBe('Una')
    expect(byId('console.account.email-cell').textContent).toBe('una@example.test')
    expect(byId('console.account.created-cell').textContent).toMatch(/^Created /)
    expect(byId('console.account.seen-cell').textContent).toMatch(/^Last seen /)
    expect(shown('console.account.verified-badge')).toBe(false)
    expect(shown('console.account.banned-badge')).toBe(false)
    expect(shown('console.account.operator-badge')).toBe(false)
    expect(shown('console.account.reason-cell')).toBe(false)
  })

  it('marks a verified operator, and shows no last seen for an account never seen', () => {
    renderView({ account: opalCard, name: 'Opal' })

    expect(byId('console.account.verified-badge').textContent).toBe('Verified')
    expect(byId('console.account.operator-badge').textContent).toBe('Operator')
    expect(shown('console.account.seen-cell')).toBe(false)
  })

  it('marks a banned account with the reason given, and with none when none was', () => {
    renderView({ account: bartCard, name: 'Bart' })

    expect(byId('console.account.banned-badge').textContent).toBe('Banned')
    expect(byId('console.account.reason-cell').textContent).toContain('spam')
  })

  it('shows no reason for a banned account banned without one', () => {
    renderView({ account: { ...bart, hasProfile: false, organisations: [] }, name: 'Bart' })

    expect(shown('console.account.banned-badge')).toBe(true)
    expect(shown('console.account.reason-cell')).toBe(false)
  })

  it("lists the account's organisations, each with its role, and none when it is in none", () => {
    renderView()

    const items = screen.getAllByTestId('console.account.organisations.item')

    expect(items.map((item) => item.getAttribute('data-id'))).toEqual(['acme', 'beta'])
    expect(
      items.map(
        (item) => within(item).getByTestId('console.account.organisations.name-cell').textContent,
      ),
    ).toEqual(['Acme', 'Beta'])
    expect(
      items.map((item) =>
        within(item)
          .getByTestId('console.account.organisations.role-badge')
          .getAttribute('data-value'),
      ),
    ).toEqual(['admin', 'member'])
    expect(
      items.map(
        (item) => within(item).getByTestId('console.account.organisations.role-badge').textContent,
      ),
    ).toEqual(['Administrator', 'Member'])
  })

  it('shows no organisations list for an account in none', () => {
    renderView({ account: opalCard, name: 'Opal' })

    expect(shown('console.account.organisations.list')).toBe(false)
  })

  it.each(['not-operator', 'account-gone', 'failed'] as const)(
    'says why the account could not be read (%s) in the place of the section',
    (code) => {
      renderView({ account: undefined, failure: code })

      expect(byId('console.account.error').getAttribute('data-code')).toBe(code)
      expect(byId('console.account.error').textContent).toBe(en[`console.account.error.${code}`])
      expect(shown('console.account.section')).toBe(false)
      expect(shown('console.account.heading')).toBe(false)
      expect(shown('console.account.back-link')).toBe(true)
    },
  )

  it('acts on nothing where it is given no areas', () => {
    renderWithProviders(<AccountView account={unaCard} failure={undefined} />)

    expect(byId('console.account.section').getAttribute('data-state')).toBe('ready')
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('offers the rename only to an account with a profile, the name as given', () => {
    renderView({ name: 'Una S' })

    expect(byId('console.account.name.form').tagName).toBe('FORM')
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(
      byId('console.account.name.name-input'),
    )
    expect(byId<HTMLInputElement>('console.account.name.name-input').value).toBe('Una S')
    expect(screen.getByRole('button', { name: 'Save the name' })).toBe(
      byId('console.account.name.save-button'),
    )
  })

  it('offers no rename to an account without a profile', () => {
    renderView({ account: bartCard, name: 'Bart' })

    expect(shown('console.account.name.form')).toBe(false)
    expect(shown('console.account.name.name-input')).toBe(false)
  })

  it('offers the resend only while the email is not verified', () => {
    renderView()

    expect(byId('console.account.verification.resend-button').textContent).toBe(
      'Resend the verification',
    )
  })

  it('offers no resend once the email is verified', () => {
    renderView({ account: opalCard, name: 'Opal' })

    expect(shown('console.account.verification.resend-button')).toBe(false)
  })

  it('offers the ban with a reason of at most 500 characters while the account is not banned', () => {
    renderView({ reason: 'spam' })

    const reason = byId<HTMLInputElement>('console.account.ban.reason-input')

    expect(byId('console.account.ban.form').tagName).toBe('FORM')
    expect(screen.getByRole('textbox', { name: 'Reason' })).toBe(reason)
    expect(reason.value).toBe('spam')
    expect(reason.maxLength).toBe(500)
    expect(byId('console.account.ban.ban-button').textContent).toBe('Ban')
    expect(shown('console.account.ban.unban-button')).toBe(false)
  })

  it('offers to lift the ban while the account is banned, and no ban', () => {
    renderView({ account: bartCard, name: 'Bart' })

    expect(shown('console.account.ban.form')).toBe(true)
    expect(byId('console.account.ban.unban-button').textContent).toBe('Lift the ban')
    expect(shown('console.account.ban.ban-button')).toBe(false)
    expect(shown('console.account.ban.reason-input')).toBe(false)
  })

  it('offers the email, the sign-out everywhere, the reset and the removal to every account', () => {
    for (const card of [unaCard, bartCard, opalCard]) {
      renderView({ account: card, name: card.name })
    }

    expect(screen.getAllByTestId('console.account.email.form')).toHaveLength(3)
    expect(screen.getAllByRole('textbox', { name: 'New email' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Send the confirmation' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Sign out everywhere' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Send a password reset' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Remove the account' })).toHaveLength(3)
  })

  it('makes every button of the card a touch target', () => {
    renderView()

    for (const button of screen.getAllByRole('button')) {
      expect(button.className, button.textContent ?? '').toMatch(/min-h-11/)
      expect(button.className, button.textContent ?? '').toMatch(/min-w-11/)
    }
  })

  it('sends each control its event, the forms with what their fields hold', () => {
    const { onAct } = renderView({ name: 'Una S', email: 'una@example.org', reason: 'spam' })

    fireEvent.submit(byId('console.account.name.form'))
    fireEvent.submit(byId('console.account.email.form'))
    fireEvent.submit(byId('console.account.ban.form'))
    fireEvent.click(byId('console.account.sessions.revoke-button'))
    fireEvent.click(byId('console.account.reset.send-button'))
    fireEvent.click(byId('console.account.verification.resend-button'))
    fireEvent.click(byId('console.account.removal.remove-button'))

    expect(onAct.mock.calls.map(([event]) => event)).toEqual([
      { type: 'console.account.name.save-button', name: 'Una S' },
      { type: 'console.account.email.send-button', email: 'una@example.org' },
      { type: 'console.account.ban.ban-button', reason: 'spam' },
      { type: 'console.account.sessions.revoke-button' },
      { type: 'console.account.reset.send-button' },
      { type: 'console.account.verification.resend-button' },
      { type: 'console.account.removal.remove-button' },
    ])
  })

  it("lifts the ban by the ban form's submit while the account is banned", () => {
    const { onAct } = renderView({ account: bartCard, name: 'Bart' })

    fireEvent.submit(byId('console.account.ban.form'))

    expect(onAct.mock.calls.map(([event]) => event)).toEqual([
      { type: 'console.account.ban.unban-button' },
    ])
  })

  it('hands what is typed to the page', () => {
    const { onName, onEmail, onReason } = renderView()

    fireEvent.change(byId('console.account.name.name-input'), { target: { value: 'U' } })
    fireEvent.change(byId('console.account.email.email-input'), { target: { value: 'u@x.test' } })
    fireEvent.change(byId('console.account.ban.reason-input'), { target: { value: 'r' } })

    expect([onName.mock.calls, onEmail.mock.calls, onReason.mock.calls]).toEqual([
      [['U']],
      [['u@x.test']],
      [['r']],
    ])
  })

  it('enables each control exactly while the flow takes its event', () => {
    renderView({
      can: (event) =>
        event.type !== 'console.account.ban.ban-button' &&
        event.type !== 'console.account.removal.remove-button',
    })

    expect(byId<HTMLButtonElement>('console.account.ban.ban-button').disabled).toBe(true)
    expect(byId<HTMLButtonElement>('console.account.removal.remove-button').disabled).toBe(true)
    expect(byId<HTMLButtonElement>('console.account.name.save-button').disabled).toBe(false)
    expect(byId<HTMLButtonElement>('console.account.sessions.revoke-button').disabled).toBe(false)
  })

  it.each([
    ['name', 'name-required', 'console.account.name.name-input'],
    ['name', 'name-too-long', 'console.account.name.name-input'],
    ['email', 'email-invalid', 'console.account.email.email-input'],
    ['email', 'email-taken', 'console.account.email.email-input'],
  ] as const)(
    'shows the %s error %s under the field it concerns, marked invalid',
    (area, code, field) => {
      renderView({ errors: { [area]: code } })

      const error = byId(`console.account.${area}.error`)
      const input = byId(field)

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toBe(en[`console.account.action-error.${code}`])
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(input.getAttribute('aria-describedby')).toBe(error.id)
      expect(input.parentElement?.contains(error)).toBe(true)
    },
  )

  it.each([
    ['name', 'failed'],
    ['email', 'rate-limited'],
    ['ban', 'own-account'],
    ['sessions', 'own-account'],
    ['reset', 'rate-limited'],
    ['verification', 'verified-before'],
    ['removal', 'last-admin'],
    ['removal', 'not-operator'],
    ['removal', 'account-gone'],
  ] as const)('shows the %s error %s in its area, no field marked', (area, code) => {
    renderView({ errors: { [area]: code } })

    const error = byId(`console.account.${area}.error`)

    expect(error.getAttribute('data-code')).toBe(code)
    expect(error.textContent).toBe(en[`console.account.action-error.${code}`])
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
  })

  it("shows a rename's error in its area once the account has no profile to rename", () => {
    renderView({ account: bartCard, name: 'Bart', errors: { name: 'failed' } })

    expect(byId('console.account.name.error').getAttribute('data-code')).toBe('failed')
    expect(shown('console.account.name.form')).toBe(false)
  })

  it('speaks Spanish', () => {
    renderView({ account: bartCard, name: 'Bart', errors: { removal: 'last-admin' } }, 'es')

    expect(byId('console.account.back-link').textContent).toBe(es['console.account.back'])
    expect(byId('console.account.ban.unban-button').textContent).toBe(
      es['console.account.ban.unban'],
    )
    expect(byId('console.account.removal.error').textContent).toBe(
      es['console.account.action-error.last-admin'],
    )
  })
})
