// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import {
  accountsNamed,
  FakeAccounts,
  refusedWith,
} from '../../../../../platform/__fixtures__/accounts'
import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { ACCOUNTS } from '../../../../../platform/accounts.port'
import { createAppRouter } from '../../../../../platform/router'
import type { SessionPort } from '../../../../../platform/session.port'
import { renderWithProviders } from '../../../../../test-utils'
import { ConsoleModule } from '../../../console.module'

const LIST = 'console.users.list'

const opal: NonNullable<ReturnType<SessionPort['current']>> = {
  id: identityIdFactory.create(),
  email: 'opal@example.test',
}

const OPERATOR: ReadonlySet<PlatformRole> = new Set(['operator'])

/** Eleven accounts named `User 1` to `User 11`, and four of another name made after them. */
const users = accountsNamed('User', 11)
const others = accountsNamed('Other', 4, new Date('2026-10-11T08:00:00.000Z'))

/**
 * The users page on the application's router for Opal, an operator, over `accounts`, opened at
 * `at`: the router strips a default from the address and keeps the size it retains, as in the app.
 */
async function openPage(accounts: FakeAccounts, at = '/console/users') {
  const session = {
    ...fakeSession().session,
    current: () => opal,
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
  await screen.findByTestId('console.users.heading')

  return router
}

/** The platform's accounts: the users and the others. */
function withAccounts(): FakeAccounts {
  const accounts = new FakeAccounts()

  accounts.rows = [...users, ...others]

  return accounts
}

/** The search the list was last read with. */
const lastRead = (accounts: FakeAccounts) =>
  accounts.calls.filter(([kind]) => kind === 'list').at(-1)?.[1]

/** The names of the rows the list shows, once it shows `count`. */
async function namesShown(count: number): Promise<string[]> {
  await waitFor(() => expect(screen.getAllByTestId(`${LIST}.account-item`)).toHaveLength(count))

  return screen.getAllByTestId(`${LIST}.name-cell`).map((cell) => cell.textContent ?? '')
}

/** Chooses `size` in the list's size select. */
async function chooseSize(size: number): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByTestId(`${LIST}.size-select`))
  await user.click(await screen.findByRole('option', { name: String(size) }))
}

/** Searches for `text`, replacing what the box holds. */
async function search(text: string): Promise<void> {
  const user = userEvent.setup()
  const input = screen.getByTestId('console.users.search-input')

  await user.clear(input)

  if (text !== '') {
    await user.type(input, text)
  }

  await user.click(screen.getByTestId('console.users.search-button'))
}

/** The address the router shows: its path and search as they would be written. */
const address = (router: Awaited<ReturnType<typeof openPage>>): string =>
  `${router.state.location.pathname}${router.state.location.searchStr}`

describe('UsersContainer on the router', () => {
  it("opens at the first page of 25 of the platform's accounts, newest first, the address plain", async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts)

    expect(await namesShown(15)).toEqual([
      ...others.map(({ name }) => name).reverse(),
      ...users.map(({ name }) => name).reverse(),
    ])
    expect(address(router)).toBe('/console/users')
    expect(lastRead(accounts)).toEqual({ q: '', page: 1, size: 25 })
    expect(screen.getByTestId(LIST).getAttribute('data-state')).toBe('ready')
  })

  it('searches anew from the first page, the text in the address', async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts, '/console/users?page=2&size=10')

    await namesShown(5)
    await search('user')

    expect(await namesShown(10)).toEqual(
      users
        .slice(1)
        .map(({ name }) => name)
        .reverse(),
    )
    expect(router.state.location.search).toEqual({ q: 'user', size: 10 })
    expect(lastRead(accounts)).toEqual({ q: 'user', page: 1, size: 10 })
  })

  it('chooses 10, then 25, then searches anew: the address carries no size and the list is read with 25', async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts)

    await namesShown(15)
    await chooseSize(10)

    await namesShown(10)
    expect(router.state.location.search).toEqual({ size: 10 })

    await chooseSize(25)

    await namesShown(15)
    expect(router.state.location.search).toEqual({})
    expect(address(router)).toBe('/console/users')

    await search('user')

    expect(await namesShown(11)).toHaveLength(11)
    expect(router.state.location.search).toEqual({ q: 'user' })
    expect(lastRead(accounts)).toEqual({ q: 'user', page: 1, size: 25 })
  })

  it.each([10, 50])('keeps a size of %i across a new search', async (size) => {
    const accounts = withAccounts()
    const router = await openPage(accounts)

    await namesShown(15)
    await chooseSize(size)
    await waitFor(() => expect(router.state.location.search).toEqual({ size }))

    await search('user')

    await waitFor(() => expect(lastRead(accounts)).toEqual({ q: 'user', page: 1, size }))
    expect(router.state.location.search).toEqual({ q: 'user', size })
  })

  it('starts the first page when a size is chosen on a later page, the search kept', async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts, '/console/users?q=%22user%22&page=2&size=10')

    await namesShown(1)
    await chooseSize(50)

    await namesShown(11)
    expect(router.state.location.search).toEqual({ q: 'user', size: 50 })
  })

  it('pages with the links before and after, each link the address it moves to', async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts, '/console/users?q=%22user%22&size=10')

    await namesShown(10)

    const next = screen.getByTestId(`${LIST}.next-link`)
    const href = next.getAttribute('href')

    expect(screen.queryByTestId(`${LIST}.previous-link`)).toBeNull()

    fireEvent.click(next)

    expect(await namesShown(1)).toEqual(['User 1'])
    expect(address(router)).toBe(href)
    expect(router.state.location.search).toEqual({ q: 'user', page: 2, size: 10 })
    expect(screen.getByTestId(`${LIST}.range`).textContent).toBe('11-11 of 11')

    fireEvent.click(screen.getByTestId(`${LIST}.previous-link`))

    await namesShown(10)
    expect(router.state.location.search).toEqual({ q: 'user', size: 10 })
  })

  it('follows the address with its search box: a reload, a new search and Back', async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts, '/console/users?q=%22user%22&page=2&size=10')
    const box = () => screen.getByTestId<HTMLInputElement>('console.users.search-input')

    await namesShown(1)
    expect(box().value).toBe('user')

    await search('other')

    await namesShown(4)
    expect(box().value).toBe('other')

    await act(async () => {
      router.history.back()
      await router.load()
    })

    expect(await namesShown(1)).toEqual(['User 1'])
    expect(box().value).toBe('user')
  })

  it("links each row to its account's card and opens it with the row's own id", async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts, '/console/users?q=%22user%22')

    await namesShown(11)

    const [row] = screen.getAllByTestId(`${LIST}.account-item`)
    const id = row?.getAttribute('data-id')
    const open = within(row ?? expect.unreachable('a row')).getByTestId(`${LIST}.open-link`)

    expect(open.getAttribute('href')).toBe(`/console/account?id=${String(id)}`)

    fireEvent.click(open)

    await waitFor(() => expect(router.state.location.pathname).toBe('/console/account'))
    expect(router.state.location.search).toEqual({ id })
  })

  it("says in the list's place that the account is no operator when the gateway refuses it", async () => {
    const accounts = withAccounts()

    accounts.refusal = refusedWith('not-operator')

    await openPage(accounts)

    const error = await screen.findByTestId('console.users.error')

    expect(error.getAttribute('data-code')).toBe('not-operator')
    expect(screen.queryByTestId(LIST)).toBeNull()
  })

  it('shows nothing of the page before while the next one is read, then that one alone', async () => {
    const accounts = withAccounts()
    const router = await openPage(accounts, '/console/users?size=10')

    await namesShown(10)

    accounts.hold = true

    await act(() => router.navigate({ to: '/console/users', search: { page: 2, size: 10 } }))

    expect(screen.getByTestId(LIST).getAttribute('data-state')).toBe('loading')
    expect(screen.queryAllByTestId(`${LIST}.account-item`)).toEqual([])
    expect(screen.queryByTestId(`${LIST}.range`)).toBeNull()

    act(() => accounts.release())

    expect(await namesShown(5)).toHaveLength(5)
  })
})
