// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import { FakeAccounts, opal, una } from '../../../../../platform/__fixtures__/accounts'
import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { ACCOUNTS } from '../../../../../platform/accounts.port'
import { createAppRouter } from '../../../../../platform/router'
import { renderWithProviders } from '../../../../../test-utils'
import { ConsoleModule } from '../../../console.module'

const OPERATOR: ReadonlySet<PlatformRole> = new Set(['operator'])

/** Opal, signed in: one value, as the session hands it out until it changes. */
const signedIn = { id: opal.id, email: opal.email }

/** Una's account as the fake gateway holds it: a profile, in one organisation as its admin. */
function withUna(): FakeAccounts {
  const accounts = new FakeAccounts()

  accounts.rows = [opal, { ...una, organisations: [{ key: 'acme', name: 'Acme', role: 'admin' }] }]

  return accounts
}

/**
 * The card on the application's router for Opal, an operator, over `accounts`, opened at `at`.
 */
async function openCard(accounts: FakeAccounts, at: string) {
  const session = {
    ...fakeSession().session,
    current: () => signedIn,
    roles: () => OPERATOR,
  }
  const services = fakeServices(session)

  services.container.singleton(ACCOUNTS, () => accounts)

  const router = createAppRouter({
    modules: [ConsoleModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  renderWithProviders(<RouterProvider router={router} />, { container: services.container })
  await screen.findByTestId('console.account.back-link')

  return router
}

const byId = <E extends HTMLElement = HTMLElement>(id: string) => screen.getByTestId<E>(id)

/** Waits for the card to show the account read, in its section. */
const ready = () =>
  waitFor(() => expect(byId('console.account.section').getAttribute('data-state')).toBe('ready'))

/** The reads of the card the fake gateway took. */
const reads = (accounts: FakeAccounts) => accounts.calls.filter(([kind]) => kind === 'read')

describe('AccountContainer on the router', () => {
  it('reads the account the address names and shows it', async () => {
    const accounts = withUna()

    await openCard(accounts, `/console/account?id=${una.id}`)
    await ready()

    expect(byId('console.account.heading').textContent).toBe('Una')
    expect(byId('console.account.email-cell').textContent).toBe(una.email)
    expect(byId('console.account.organisations.role-badge').getAttribute('data-value')).toBe(
      'admin',
    )
    expect(reads(accounts)).toEqual([['read', una.id]])
  })

  it.each([
    ['names no account', '/console/account'],
    ['names something that is no identity id', '/console/account?id=nobody'],
  ])('says account-gone where the address %s, asking nobody', async (_case, at) => {
    const accounts = withUna()

    await openCard(accounts, at)

    expect((await screen.findByTestId('console.account.error')).getAttribute('data-code')).toBe(
      'account-gone',
    )
    expect(accounts.calls).toEqual([])
    expect(screen.queryByTestId('console.account.section')).toBeNull()
  })

  it('says account-gone for an account no longer there', async () => {
    await openCard(withUna(), `/console/account?id=${identityIdFactory.create()}`)

    expect((await screen.findByTestId('console.account.error')).getAttribute('data-code')).toBe(
      'account-gone',
    )
  })

  it('renames the account and shows the name read again', async () => {
    const accounts = withUna()

    await openCard(accounts, `/console/account?id=${una.id}`)
    await ready()

    fireEvent.change(byId('console.account.name.name-input'), { target: { value: 'Una Smith' } })
    fireEvent.click(byId('console.account.name.save-button'))

    await waitFor(() => expect(byId('console.account.heading').textContent).toBe('Una Smith'))
    expect(accounts.calls).toEqual([
      ['read', una.id],
      ['rename', una.id, 'Una Smith'],
      ['read', una.id],
    ])
  })

  it('empties the new email once its mail is on its way, the email kept', async () => {
    const accounts = withUna()

    await openCard(accounts, `/console/account?id=${una.id}`)
    await ready()

    const input = byId<HTMLInputElement>('console.account.email.email-input')

    fireEvent.change(input, { target: { value: 'una@example.org' } })
    fireEvent.click(byId('console.account.email.send-button'))

    await waitFor(() => expect(input.value).toBe(''))
    expect(accounts.calls).toContainEqual(['changeEmail', una.id, 'una@example.org'])
    expect(byId('console.account.email-cell').textContent).toBe(una.email)
  })

  it('shows a taken email under its field, the email kept as typed', async () => {
    const accounts = withUna()

    await openCard(accounts, `/console/account?id=${una.id}`)
    await ready()
    accounts.refuse('changeEmail', 'email-taken')

    const input = byId<HTMLInputElement>('console.account.email.email-input')

    fireEvent.change(input, { target: { value: 'opal@example.test' } })
    fireEvent.click(byId('console.account.email.send-button'))

    expect(
      (await screen.findByTestId('console.account.email.error')).getAttribute('data-code'),
    ).toBe('email-taken')
    expect(input.value).toBe('opal@example.test')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('bans the account with its reason, then lifts the ban', async () => {
    const accounts = withUna()

    await openCard(accounts, `/console/account?id=${una.id}`)
    await ready()

    fireEvent.change(byId('console.account.ban.reason-input'), { target: { value: 'spam' } })
    fireEvent.click(byId('console.account.ban.ban-button'))

    await screen.findByTestId('console.account.banned-badge')
    expect(byId('console.account.reason-cell').textContent).toContain('spam')
    expect(screen.queryByTestId('console.account.ban.ban-button')).toBeNull()
    expect(screen.queryByTestId('console.account.ban.reason-input')).toBeNull()

    fireEvent.click(byId('console.account.ban.unban-button'))

    await screen.findByTestId('console.account.ban.ban-button')
    expect(screen.queryByTestId('console.account.banned-badge')).toBeNull()
    expect(screen.queryByTestId('console.account.reason-cell')).toBeNull()
    expect(byId<HTMLInputElement>('console.account.ban.reason-input').value).toBe('')
    expect(accounts.calls).toContainEqual(['ban', una.id, 'spam'])
    expect(accounts.calls).toContainEqual(['unban', una.id])
  })

  it('moves to the accounts once the account is removed', async () => {
    const accounts = withUna()
    const router = await openCard(accounts, `/console/account?id=${una.id}`)

    await ready()
    fireEvent.click(byId('console.account.removal.remove-button'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/console/users'))
    expect(accounts.rows.some((row) => row.id === una.id)).toBe(false)
    await screen.findByTestId('console.users.heading')
  })

  it('stays on the card with last-admin when the removal is refused, the card read again', async () => {
    const accounts = withUna()
    const router = await openCard(accounts, `/console/account?id=${una.id}`)

    await ready()
    accounts.refuse('remove', 'last-admin')
    fireEvent.click(byId('console.account.removal.remove-button'))

    expect(
      (await screen.findByTestId('console.account.removal.error')).getAttribute('data-code'),
    ).toBe('last-admin')
    await waitFor(() => expect(reads(accounts)).toHaveLength(2))
    expect(router.state.location.pathname).toBe('/console/account')
    expect(byId('console.account.organisations.item').getAttribute('data-id')).toBe('acme')
  })

  it('keeps the card shown while it is read again after an action', async () => {
    const accounts = withUna()

    await openCard(accounts, `/console/account?id=${una.id}`)
    await ready()

    accounts.hold = true
    fireEvent.click(byId('console.account.reset.send-button'))
    act(() => accounts.release())

    await waitFor(() => expect(reads(accounts)).toHaveLength(2))
    expect(byId('console.account.section').getAttribute('data-state')).toBe('ready')
    expect(byId('console.account.heading').textContent).toBe('Una')

    act(() => accounts.release())
    await waitFor(() => expect(accounts.calls).toContainEqual(['sendReset', una.id]))
  })

  it("starts afresh on another account's card", async () => {
    const accounts = withUna()
    const router = await openCard(accounts, `/console/account?id=${una.id}`)

    await ready()
    accounts.refuse('sendReset', 'rate-limited')
    fireEvent.click(byId('console.account.reset.send-button'))
    await screen.findByTestId('console.account.reset.error')

    await act(() => router.navigate({ to: '/console/account', search: { id: opal.id } }))

    await waitFor(() => expect(byId('console.account.heading').textContent).toBe('Opal'))
    expect(screen.queryByTestId('console.account.reset.error')).toBeNull()
  })
})
