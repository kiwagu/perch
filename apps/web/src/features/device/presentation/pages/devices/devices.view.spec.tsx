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
  const handlers = { onRevoke: vi.fn(), onSignOutEverywhere: vi.fn() }

  renderWithProviders(<DevicesView devices={[laptop, phone, tablet]} {...handlers} {...props} />, {
    locale,
    es,
  })

  return handlers
}

/** The rows of the list, by the label each shows. */
function rows() {
  return new Map(
    screen
      .getAllByTestId('device.list.item')
      .map((row) => [within(row).getByTestId('device.list.label').textContent, row]),
  )
}

function row(label: string): HTMLElement {
  return rows().get(label) ?? expect.unreachable(`a row for ${label}`)
}

describe('DevicesView', () => {
  it('lists each device with its label and when it was last seen, and marks this device', () => {
    renderView()

    expect([...rows().keys()]).toEqual([laptop.label, phone.label, tablet.label])
    expect(within(row(laptop.label)).getByTestId('device.list.current').textContent).toBe(
      en['device.list.current'],
    )
    expect(within(row(phone.label)).queryByTestId('device.list.current')).toBeNull()
    expect(within(row(phone.label)).getByTestId('device.list.seen').textContent).toBe(
      en['device.list.seen'].replace('{when}', when(phone.lastSeenAt)),
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['device.page.title'])
  })

  it('offers no sign-out on the row of this device, which signs out through its session', () => {
    renderView()

    expect(within(row(laptop.label)).queryByTestId('device.list.revoke')).toBeNull()
    expect(screen.getAllByTestId('device.list.revoke')).toHaveLength(1)
  })

  it('signs another device out from its row', () => {
    const { onRevoke } = renderView()

    fireEvent.click(within(row(phone.label)).getByTestId('device.list.revoke'))

    expect(onRevoke).toHaveBeenCalledWith(phone)
  })

  it('says when a device was signed out and offers nothing more for it', () => {
    renderView()

    expect(within(row(tablet.label)).getByTestId('device.list.revoked').textContent).toBe(
      en['device.list.revoked'].replace('{when}', when(tablet.revokedAt ?? new Date(0))),
    )
    expect(within(row(tablet.label)).queryByTestId('device.list.revoke')).toBeNull()
  })

  it('asks before signing out everywhere, and signs out only once confirmed', async () => {
    const { onSignOutEverywhere } = renderView()

    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(screen.getByTestId('device.everywhere.open'))

    const dialog = await screen.findByRole('alertdialog')

    expect(dialog.textContent).toContain(en['device.everywhere.title'])
    expect(dialog.textContent).toContain(en['device.everywhere.body'])

    fireEvent.click(screen.getByTestId('device.everywhere.cancel'))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onSignOutEverywhere).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('device.everywhere.open'))
    fireEvent.click(await screen.findByTestId('device.everywhere.confirm'))

    expect(onSignOutEverywhere).toHaveBeenCalledOnce()
  })

  it('holds the sign-out buttons while a sign-out runs', () => {
    renderView({ pending: true })

    expect((screen.getByTestId('device.list.revoke') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('device.everywhere.open') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says the devices are being read until they are', () => {
    renderView({ devices: undefined })

    expect(screen.getByTestId('device.page.status').textContent).toBe(en['device.page.loading'])
    expect(screen.queryByTestId('device.list.item')).toBeNull()
  })

  it('speaks Spanish, its times written the Spanish way', () => {
    renderView({}, 'es')

    expect(within(row(laptop.label)).getByTestId('device.list.current').textContent).toBe(
      es['device.list.current'],
    )
    expect(within(row(phone.label)).getByTestId('device.list.seen').textContent).toBe(
      es['device.list.seen'].replace('{when}', when(phone.lastSeenAt, 'es')),
    )
    expect(screen.getByTestId('device.everywhere.open').textContent).toBe(
      es['device.everywhere.open'],
    )
  })
})
