// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'

import { FakeDevices, offline, phone, rejected } from '../../../../../platform/__fixtures__/devices'
import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { DEVICES } from '../../../../../platform/devices.port'
import { NoticeProvider } from '../../../../../platform/notices'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import { ShellContainer } from '../../../../app-shell/presentation/shell/shell.container'
import { DeviceModule } from '../../../device.module'
import en from '../../i18n/device.en.json'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }

let devices: FakeDevices

/** How many times the page had the session sign this device out. */
let signedOutHere = 0

/** The devices page in the application's frame, for Ann signed in, over `devices`. */
async function openPage(): Promise<void> {
  signedOutHere = 0

  const session = {
    ...fakeSession().session,
    current: () => ann,
    signingOutEverywhere: () => () => {
      signedOutHere += 1

      return okAsync(undefined)
    },
  }
  const router = createAppRouter({
    modules: [DeviceModule],
    session,
    layout: () => (
      <NoticeProvider>
        <ShellContainer>
          <Outlet />
        </ShellContainer>
      </NoticeProvider>
    ),
    history: createMemoryHistory({ initialEntries: ['/devices'] }),
  })
  const services = fakeServices(session)

  services.container.singleton(DEVICES, () => devices)

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={services}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )
  await screen.findByTestId('app-shell.nav.devices')
}

/** The row of the device with `label`, once the list shows it. */
async function row(label: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('device.list.item')

  return (
    rows.find((each) => within(each).getByTestId('device.list.label').textContent === label) ??
    expect.unreachable(`a row for ${label}`)
  )
}

describe('DevicesContainer', () => {
  it('reads the devices when the page opens', async () => {
    devices = new FakeDevices()

    await openPage()

    expect(await screen.findAllByTestId('device.list.item')).toHaveLength(2)
    expect(devices.calls).toEqual([['list']])
  })

  it('signs another device out, then shows the list read again', async () => {
    devices = new FakeDevices()

    await openPage()
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke'))

    expect(await within(await row(phone.label)).findByTestId('device.list.revoked')).toBeTruthy()
    expect(within(await row(phone.label)).queryByTestId('device.list.revoke')).toBeNull()
    expect(devices.calls).toEqual([['list'], ['revoke', phone.id], ['list']])
  })

  it('says so when the gateway refuses a sign-out, and reads the list again', async () => {
    devices = new FakeDevices()

    await openPage()
    devices.refusal = rejected('no-such-device')
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke'))

    expect((await screen.findByTestId('device.notice')).textContent).toBe(
      en['device.notice.sign-out-failed'],
    )
    await waitFor(() => expect(devices.calls).toEqual([['list'], ['revoke', phone.id], ['list']]))
  })

  it('keeps saying the sign-out failed when the gateway is out of reach, without reading the list again', async () => {
    devices = new FakeDevices()

    await openPage()

    const list = devices.list.bind(devices)

    // Out of reach: the sign-out fails, and so would a read after it.
    devices.refusal = offline()
    devices.list = () => {
      devices.refusal = offline()

      return list()
    }
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke'))

    expect((await screen.findByTestId('device.notice')).textContent).toBe(
      en['device.notice.sign-out-failed'],
    )
    await waitFor(async () =>
      expect(
        (within(await row(phone.label)).getByTestId('device.list.revoke') as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(devices.calls).toEqual([['list'], ['revoke', phone.id]])
    expect(screen.getByTestId('device.notice').textContent).toBe(
      en['device.notice.sign-out-failed'],
    )
  })

  it('says so when the devices cannot be read', async () => {
    devices = new FakeDevices()
    devices.refusal = offline()

    await openPage()

    expect((await screen.findByTestId('device.notice')).textContent).toBe(
      en['device.notice.read-failed'],
    )
    expect(screen.getByTestId('device.page.status').textContent).toBe(en['device.page.loading'])
  })

  it('signs out everywhere once confirmed, and has the session sign this device out without waiting for its channel', async () => {
    devices = new FakeDevices()

    await openPage()
    await row(phone.label)
    fireEvent.click(screen.getByTestId('device.everywhere.open'))
    fireEvent.click(await screen.findByTestId('device.everywhere.confirm'))

    await waitFor(() => expect(signedOutHere).toBe(1))
    expect(devices.calls).toEqual([['list'], ['everywhere']])
  })

  it('says so when signing out everywhere fails, and lets it be asked again', async () => {
    devices = new FakeDevices()

    await openPage()
    await row(phone.label)
    devices.refusal = offline()
    fireEvent.click(screen.getByTestId('device.everywhere.open'))
    fireEvent.click(await screen.findByTestId('device.everywhere.confirm'))

    expect((await screen.findByTestId('device.notice')).textContent).toBe(
      en['device.notice.sign-out-failed'],
    )
    expect((screen.getByTestId('device.everywhere.open') as HTMLButtonElement).disabled).toBe(false)
    expect(signedOutHere).toBe(0)
  })
})
