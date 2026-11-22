// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { laptopKey, securityKey } from '../../../../../platform/__fixtures__/passkeys'
import { renderWithProviders } from '../../../../../test-utils'

import { PasskeysListView, type PasskeysListViewProps } from './passkeys-list.view'

const LIST = 'user.settings.passkeys.list'
const ITEM = 'user.settings.passkeys.passkey-item'
const ADDED = 'user.settings.passkeys.added-cell'
const REMOVE = 'user.settings.passkeys.remove-button'
const ADD = 'user.settings.passkeys.add-button'
const ERROR = 'user.settings.passkeys.error'

function renderView(props: Partial<PasskeysListViewProps> = {}) {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn() }

  renderWithProviders(
    <PasskeysListView
      passkeys={{ status: 'ready', items: [laptopKey, securityKey] }}
      can={() => true}
      {...handlers}
      {...props}
    />,
  )

  return handlers
}

const state = () => screen.getByTestId(LIST).getAttribute('data-state')

describe('PasskeysListView', () => {
  it('lists each passkey by when it was added, the earliest first, each with its id', () => {
    renderView()

    const items = screen.getAllByTestId(ITEM)

    expect(state()).toBe('ready')
    expect(items.map((item) => item.getAttribute('data-id'))).toEqual([
      laptopKey.id,
      securityKey.id,
    ])
    expect(within(items[0] ?? document.body).getByTestId(ADDED).textContent).toContain('2026')
    expect(items.every((item) => screen.getByTestId(LIST).contains(item))).toBe(true)
  })

  it.each([
    [{ status: 'loading' }, 'loading', 'Loading the passkeys…'],
    [{ status: 'error' }, 'error', 'The passkeys could not be read.'],
    [{ status: 'ready', items: [] }, 'empty', 'No passkey yet.'],
  ] as const)('is %j while its data is %s, and says so', (passkeys, expected, text) => {
    renderView({ passkeys })

    expect(state()).toBe(expected)
    expect(screen.queryAllByTestId(ITEM)).toHaveLength(0)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('offers to add one whatever the list holds, and to remove each', () => {
    const { onAdd, onRemove } = renderView()

    fireEvent.click(screen.getByTestId(ADD))
    fireEvent.click(within(screen.getAllByTestId(ITEM)[1] ?? document.body).getByTestId(REMOVE))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(securityKey.id)
  })

  it('offers to add one even before the list is read', () => {
    renderView({ passkeys: { status: 'loading' } })

    expect(screen.getByTestId(ADD)).toBeTruthy()
  })

  it('enables each button exactly while the flow takes its event', () => {
    const can = vi.fn((event: { readonly type: string }) => event.type === ADD)

    renderView({ can })

    expect((screen.getByTestId(ADD) as HTMLButtonElement).disabled).toBe(false)
    expect(
      screen.getAllByTestId(REMOVE).map((remove) => (remove as HTMLButtonElement).disabled),
    ).toEqual([true, true])
    expect(can).toHaveBeenCalledWith({ type: REMOVE, passkey: laptopKey.id })
    expect(can).toHaveBeenCalledWith({ type: ADD })
  })

  it.each([
    ['data:PASSKEY_CANCELLED', 'passkey-cancelled'],
    ['data:AUTH_FAILED', 'failed'],
    ['data:WRITE_REJECTED', 'failed'],
  ])('says a failure of %s as %s', (failure, code) => {
    renderView({ error: failure })

    expect(screen.getByTestId(ERROR).getAttribute('data-code')).toBe(code)
  })

  it('says nothing before a failure', () => {
    renderView()

    expect(screen.queryByTestId(ERROR)).toBeNull()
  })
})
