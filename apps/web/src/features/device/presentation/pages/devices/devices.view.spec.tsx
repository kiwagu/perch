// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { device_sessionIdFactory } from '@workspace/ids'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/device.en.json'
import es from '../../i18n/device.es.json'

import { type DeviceItem, DevicesView, type DevicesViewProps } from './devices.view'

const laptop: DeviceItem = {
  id: device_sessionIdFactory.create(),
  label: 'Firefox on Linux',
  lastSeenAt: new Date('2026-10-18T09:30:00.000Z'),
  current: true,
}

const phone: DeviceItem = {
  id: device_sessionIdFactory.create(),
  label: 'Safari on iPhone',
  lastSeenAt: new Date('2026-10-17T21:15:00.000Z'),
  current: false,
}

const tablet: DeviceItem = {
  id: device_sessionIdFactory.create(),
  label: 'Chrome on Android',
  lastSeenAt: new Date('2026-10-12T07:00:00.000Z'),
  revokedAt: new Date('2026-10-13T18:45:00.000Z'),
  current: false,
}

/** A time as the page writes it in `locale`. */
const when = (date: Date, locale: 'en' | 'es' = 'en') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)

function renderView(props: Partial<DevicesViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = {
    onRevoke: vi.fn(),
    onOpenEverywhere: vi.fn(),
    onSignOutEverywhere: vi.fn(),
    onCancelEverywhere: vi.fn(),
  }
  const view = (more: Partial<DevicesViewProps>) => (
    <DevicesView
      devices={[laptop, phone, tablet]}
      can={() => true}
      confirming={false}
      {...handlers}
      {...props}
      {...more}
    />
  )
  const { rerender } = renderWithProviders(view({}), { locale, es })

  return { ...handlers, rerender: (more: Partial<DevicesViewProps>) => rerender(view(more)) }
}

/** The rows of the list, by the label each shows. */
function rows() {
  return new Map(
    screen
      .getAllByTestId('device.list.session-item')
      .map((row) => [within(row).getByTestId('device.list.label-cell').textContent, row]),
  )
}

function row(label: string): HTMLElement {
  return rows().get(label) ?? expect.unreachable(`a row for ${label}`)
}

describe('DevicesView', () => {
  it('lists each device with its label and when it was last seen, and marks this device', () => {
    renderView()

    expect([...rows().keys()]).toEqual([laptop.label, phone.label, tablet.label])
    expect(within(row(laptop.label)).getByTestId('device.list.current-badge').textContent).toBe(
      en['device.list.current'],
    )
    expect(within(row(phone.label)).queryByTestId('device.list.current-badge')).toBeNull()
    expect(within(row(phone.label)).getByTestId('device.list.seen-cell').textContent).toBe(
      en['device.list.seen'].replace('{when}', when(phone.lastSeenAt)),
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['device.page.title'])
  })

  it('carries each device session id, and marks this device and a signed-out one by state', () => {
    renderView()

    expect(row(laptop.label).getAttribute('data-id')).toBe(laptop.id)
    expect(row(laptop.label).getAttribute('data-state')).toBe('current')
    expect(row(phone.label).getAttribute('data-id')).toBe(phone.id)
    expect(row(phone.label).hasAttribute('data-state')).toBe(false)
    expect(row(tablet.label).getAttribute('data-state')).toBe('revoked')
  })

  it('offers no sign-out on the row of this device, which signs out through its session', () => {
    renderView()

    expect(within(row(laptop.label)).queryByTestId('device.list.revoke-button')).toBeNull()
    expect(screen.getAllByTestId('device.list.revoke-button')).toHaveLength(1)
  })

  it('signs another device out from its row', () => {
    const { onRevoke } = renderView()

    fireEvent.click(within(row(phone.label)).getByTestId('device.list.revoke-button'))

    expect(onRevoke).toHaveBeenCalledWith(phone)
  })

  it('says when a device was signed out and offers nothing more for it', () => {
    renderView()

    expect(within(row(tablet.label)).getByTestId('device.list.revoked-cell').textContent).toBe(
      en['device.list.revoked'].replace('{when}', when(tablet.revokedAt ?? new Date(0))),
    )
    expect(within(row(tablet.label)).queryByTestId('device.list.revoke-button')).toBeNull()
  })

  it('asks before signing out everywhere, and signs out only once confirmed', async () => {
    const { onOpenEverywhere, onSignOutEverywhere, onCancelEverywhere, rerender } = renderView()

    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(screen.getByTestId('device.everywhere.open-button'))

    expect(onOpenEverywhere).toHaveBeenCalledOnce()

    rerender({ confirming: true })

    const dialog = await screen.findByRole('alertdialog')

    expect(dialog.getAttribute('data-testid')).toBe('device.everywhere.dialog')
    expect(dialog.getAttribute('data-code')).toBe('sign-out-everywhere')
    expect(dialog.textContent).toContain(en['device.everywhere.title'])
    expect(dialog.textContent).toContain(en['device.everywhere.body'])

    fireEvent.click(screen.getByTestId('device.everywhere.dialog.cancel-button'))

    expect(onCancelEverywhere).toHaveBeenCalled()

    rerender({ confirming: false })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onSignOutEverywhere).not.toHaveBeenCalled()

    rerender({ confirming: true })
    fireEvent.click(await screen.findByTestId('device.everywhere.dialog.confirm-button'))

    expect(onSignOutEverywhere).toHaveBeenCalledOnce()
  })

  it("holds the sign-out buttons while the page's flow does not take them", () => {
    renderView({ can: () => false })

    expect((screen.getByTestId('device.list.revoke-button') as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(
      (screen.getByTestId('device.everywhere.open-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('says the devices are being read until they are', () => {
    renderView({ devices: undefined })

    expect(screen.getByTestId('device.page.status').getAttribute('data-state')).toBe('loading')
    expect(screen.getByTestId('device.page.status').textContent).toBe(en['device.page.loading'])
    expect(screen.queryByTestId('device.list.session-item')).toBeNull()
  })

  it('speaks Spanish, its times written the Spanish way', () => {
    renderView({}, 'es')

    expect(within(row(laptop.label)).getByTestId('device.list.current-badge').textContent).toBe(
      es['device.list.current'],
    )
    expect(within(row(phone.label)).getByTestId('device.list.seen-cell').textContent).toBe(
      es['device.list.seen'].replace('{when}', when(phone.lastSeenAt, 'es')),
    )
    expect(screen.getByTestId('device.everywhere.open-button').textContent).toBe(
      es['device.everywhere.open'],
    )
  })
})
