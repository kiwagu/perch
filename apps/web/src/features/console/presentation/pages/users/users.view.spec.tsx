// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { IdentityId } from '@workspace/ids'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'
import { sizeOptionOf } from '@workspace/ui-contract/anchors'

import { accountsNamed, bart, opal, una } from '../../../../../platform/__fixtures__/accounts'
import type { AccountPage } from '../../../../../platform/accounts.port'
import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/console.en.json'
import es from '../../i18n/console.es.json'

import { UsersView, type UsersViewProps } from './users.view'

const LIST = 'console.users.list'

/** Whether a field of the page holds unsaved input, as the frame's leave guard reads it. */
let unsavedNow = false

function UnsavedProbe() {
  unsavedNow = useUnsavedInput()

  return null
}

/** The view in the frame's scope of unsaved input, with a probe reading it. */
const inUnsavedScope = (view: ReactElement) => (
  <UnsavedInputScope>
    {view}
    <UnsavedProbe />
  </UnsavedInputScope>
)

/**
 * The users page with `props` over a first page of 25 holding Bart, Una and Opal, set into
 * `around` when it is given.
 */
function renderView(
  props: Partial<UsersViewProps> = {},
  around: (view: ReactElement) => ReactElement = (view) => view,
) {
  const handlers = {
    onText: vi.fn(),
    onSearch: vi.fn(() => Promise.resolve(true)),
    onPage: vi.fn(),
    onSize: vi.fn(),
    onOpen: vi.fn(),
  }
  const all: UsersViewProps = {
    text: '',
    page: { accounts: [bart, una, opal], total: 3 },
    failure: undefined,
    at: { page: 1, size: 25 },
    pageHref: (page) => `/console/users?page=${page}`,
    accountHref: (id: IdentityId) => `/console/account?id=${id}`,
    can: () => true,
    ...handlers,
    ...props,
  }
  const rendered = renderWithProviders(around(<UsersView {...all} />))

  return { ...rendered, ...handlers, view: all }
}

const rows = () => screen.queryAllByTestId(`${LIST}.account-item`)

describe('UsersView', () => {
  it('names the screen and offers the search with the text it is given', () => {
    renderView({ text: 'ann' })

    expect(screen.getByTestId('console.users.heading').textContent).toBe(
      en['console.users.heading'],
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Accounts')
    expect(screen.getByTestId('console.users.search-form').tagName).toBe('FORM')
    expect(screen.getByRole('textbox', { name: 'Search' })).toBe(
      screen.getByTestId('console.users.search-input'),
    )
    expect(screen.getByTestId<HTMLInputElement>('console.users.search-input').value).toBe('ann')
    expect(screen.getByRole('button', { name: 'Search' })).toBe(
      screen.getByTestId('console.users.search-button'),
    )
  })

  it('types into the box and searches on the button, as long as the flow takes it', async () => {
    const { onText, onSearch, rerender } = renderView()
    const user = userEvent.setup()

    await user.type(screen.getByTestId('console.users.search-input'), 'a')

    expect(onText).toHaveBeenCalledWith('a')

    await user.click(screen.getByTestId('console.users.search-button'))

    expect(onSearch).toHaveBeenCalledTimes(1)

    rerender(
      <UsersView
        text=""
        page={undefined}
        failure={undefined}
        at={{ page: 1, size: 25 }}
        pageHref={() => '/'}
        accountHref={() => '/'}
        can={() => false}
        onText={onText}
        onSearch={onSearch}
        onPage={vi.fn()}
        onSize={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByTestId<HTMLButtonElement>('console.users.search-button').disabled).toBe(true)
  })

  it('shows the list loading while the page is read, with its size select and nothing else', () => {
    renderView({ page: undefined })

    expect(screen.getByTestId(LIST).getAttribute('data-state')).toBe('loading')
    expect(rows()).toEqual([])
    expect(screen.getByTestId(`${LIST}.size-select`)).toBeDefined()
    expect(screen.queryByTestId(`${LIST}.range`)).toBeNull()
    expect(screen.queryByTestId(`${LIST}.previous-link`)).toBeNull()
    expect(screen.queryByTestId(`${LIST}.next-link`)).toBeNull()
    expect(screen.queryByTestId('console.users.error')).toBeNull()
  })

  it('shows each account of the page in its row: its name, email, when it was made and its marks', () => {
    renderView()

    expect(screen.getByTestId(LIST).getAttribute('data-state')).toBe('ready')
    expect(rows().map((row) => row.getAttribute('data-id'))).toEqual([bart.id, una.id, opal.id])

    const [bartRow, unaRow, opalRow] = rows().map((row) => within(row))
    const marks = (row: typeof bartRow) =>
      ['verified', 'banned', 'operator'].filter(
        (mark) => row?.queryByTestId(`${LIST}.${mark}-badge`) !== null,
      )

    expect(bartRow?.getByTestId(`${LIST}.name-cell`).textContent).toBe('Bart')
    expect(bartRow?.getByTestId(`${LIST}.email-cell`).textContent).toBe('bart@example.test')
    expect(bartRow?.getByTestId(`${LIST}.created-cell`).textContent).toMatch(/^Created .+/)
    expect(marks(bartRow)).toEqual(['verified', 'banned'])
    expect(marks(unaRow)).toEqual([])
    expect(marks(opalRow)).toEqual(['verified', 'operator'])
    expect(opalRow?.getByTestId(`${LIST}.operator-badge`).textContent).toBe('Operator')
  })

  it('says which accounts the page shows of how many, and links to no other page while one holds them all', () => {
    renderView()

    const range = screen.getByTestId(`${LIST}.range`)

    expect([range.dataset['from'], range.dataset['to'], range.dataset['total']]).toEqual([
      '1',
      '3',
      '3',
    ])
    expect(range.textContent).toBe('1-3 of 3')
    expect(screen.queryByTestId(`${LIST}.previous-link`)).toBeNull()
    expect(screen.queryByTestId(`${LIST}.next-link`)).toBeNull()
  })

  it('links to the pages before and after a middle page, a plain click moving there itself', () => {
    const page: AccountPage = { accounts: accountsNamed('User', 10), total: 25 }
    const { onPage } = renderView({ page, at: { page: 2, size: 10 } })

    const range = screen.getByTestId(`${LIST}.range`)
    const previous = screen.getByTestId(`${LIST}.previous-link`)
    const next = screen.getByTestId(`${LIST}.next-link`)

    expect(range.textContent).toBe('11-20 of 25')
    expect(previous.getAttribute('href')).toBe('/console/users?page=1')
    expect(next.getAttribute('href')).toBe('/console/users?page=3')
    expect(next.textContent).toBe('Next')

    expect(fireEvent.click(next)).toBe(false)
    expect(onPage).toHaveBeenLastCalledWith(3)

    expect(fireEvent.click(previous)).toBe(false)
    expect(onPage).toHaveBeenLastCalledWith(1)
  })

  it('leaves a click with a modifier, or of another button, to the link itself', () => {
    const page: AccountPage = { accounts: accountsNamed('User', 10), total: 25 }
    const { onPage } = renderView({ page, at: { page: 2, size: 10 } })
    const next = screen.getByTestId(`${LIST}.next-link`)

    expect(fireEvent.click(next, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(next, { metaKey: true })).toBe(true)
    expect(fireEvent.click(next, { shiftKey: true })).toBe(true)
    expect(fireEvent.click(next, { button: 1 })).toBe(true)
    expect(onPage).not.toHaveBeenCalled()
  })

  it('holds no row on a page past the last, saying 0 of the total, with the link back', () => {
    renderView({ page: { accounts: [], total: 11 }, at: { page: 3, size: 10 } })

    const range = screen.getByTestId(`${LIST}.range`)

    expect(screen.getByTestId(LIST).getAttribute('data-state')).toBe('ready')
    expect(rows()).toEqual([])
    expect([range.dataset['from'], range.dataset['to'], range.dataset['total']]).toEqual([
      '0',
      '0',
      '11',
    ])
    expect(range.textContent).toBe('0 of 11')
    expect(screen.getByTestId(`${LIST}.previous-link`).getAttribute('href')).toBe(
      '/console/users?page=2',
    )
    expect(screen.queryByTestId(`${LIST}.next-link`)).toBeNull()
  })

  it('shows the list empty when the search finds no account', () => {
    renderView({ page: { accounts: [], total: 0 } })

    expect(screen.getByTestId(LIST).getAttribute('data-state')).toBe('empty')
    expect(rows()).toEqual([])
    expect(screen.getByText(en['console.users.list.empty'])).toBeDefined()
    expect(screen.queryByTestId(`${LIST}.previous-link`)).toBeNull()
    expect(screen.queryByTestId(`${LIST}.next-link`)).toBeNull()
  })

  it.each([
    ['not-operator', en['console.users.error.not-operator']],
    ['failed', en['console.users.error.failed']],
  ] as const)(
    'says why the accounts could not be read in the place of the list: %s',
    (code, text) => {
      renderView({ page: undefined, failure: code })

      const error = screen.getByTestId('console.users.error')

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toBe(text)
      expect(screen.queryByTestId(LIST)).toBeNull()
      expect(screen.queryByTestId(`${LIST}.size-select`)).toBeNull()
      expect(screen.queryByTestId(`${LIST}.range`)).toBeNull()
    },
  )

  it('offers the sizes a page takes, the one the address names chosen, and moves with the one chosen', async () => {
    const { onSize } = renderView({ at: { page: 1, size: 25 } })
    const select = screen.getByTestId(`${LIST}.size-select`)
    const user = userEvent.setup()

    expect(select.getAttribute('data-value')).toBe('25')
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBe(select)

    await user.click(select)

    const options = await screen.findAllByTestId(sizeOptionOf(LIST))

    expect(options.map((option) => option.getAttribute('data-value'))).toEqual(['10', '25', '50'])

    await user.click(await screen.findByRole('option', { name: '10' }))

    expect(onSize).toHaveBeenCalledWith(10)
  })

  it('chooses a size at once: the select holds no input, so it shows no state and a leave asks nothing', async () => {
    const { view, rerender } = renderView({ at: { page: 1, size: 25 } }, inUnsavedScope)
    const user = userEvent.setup()

    await user.click(screen.getByTestId(`${LIST}.size-select`))
    await user.click(await screen.findByRole('option', { name: '10' }))
    rerender(inUnsavedScope(<UsersView {...view} at={{ page: 1, size: 10 }} />))

    const select = screen.getByTestId(`${LIST}.size-select`)

    expect(select.getAttribute('data-value')).toBe('10')
    expect(select.hasAttribute('data-state')).toBe(false)
    expect(unsavedNow).toBe(false)
  })

  it("links each row to its account's card, a plain click opening the entry's own id", () => {
    const { onOpen } = renderView()
    const [, unaRow] = rows()
    const open = within(unaRow ?? expect.unreachable('a row')).getByTestId(`${LIST}.open-link`)

    expect(open.getAttribute('href')).toBe(`/console/account?id=${una.id}`)
    expect(open.textContent).toBe('Open')
    expect(fireEvent.click(open, { ctrlKey: true })).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()

    expect(fireEvent.click(open)).toBe(false)
    expect(onOpen).toHaveBeenCalledWith(una.id)
  })

  it('makes every link of the list a touch target, 8 px from its neighbours', () => {
    const page: AccountPage = { accounts: accountsNamed('User', 10), total: 25 }

    renderView({ page, at: { page: 2, size: 10 } })

    const links = [
      ...screen.getAllByTestId(`${LIST}.open-link`),
      screen.getByTestId(`${LIST}.previous-link`),
      screen.getByTestId(`${LIST}.next-link`),
    ]

    expect(links).toHaveLength(12)

    for (const link of links) {
      const what = `${link.dataset['testid']}: ${link.className}`

      expect(link.className, what).toMatch(/\binline-flex\b/)
      expect(link.className, what).toMatch(/\bmin-h-11\b/)
      expect(link.className, what).toMatch(/\bmin-w-11\b/)
      expect(link.parentElement?.className, what).toMatch(/\bgap-2\b/)
    }
  })

  it('has every text in Spanish too', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })
})
