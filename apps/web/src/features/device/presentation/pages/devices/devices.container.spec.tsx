// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'

import { FakeDevices, offline, phone } from '../../../../../platform/__fixtures__/devices'
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

/** The devices page in the application's frame, for Ann signed in, over `devices`. */
async function openPage(): Promise<void> {
  const session = { ...fakeSession().session, current: () => ann }
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

  it('says so when a sign-out fails, and reads the list again', async () => {
    devices = new FakeDevices()

    await openPage()
    devices.refusal = offline()
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke'))

    expect((await screen.findByTestId('device.notice')).textContent).toBe(
      en['device.notice.sign-out-failed'],
    )
    await waitFor(() => expect(devices.calls).toEqual([['list'], ['revoke', phone.id], ['list']]))
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

  it('signs out everywhere once confirmed, then waits for the session to sign this device out', async () => {
    devices = new FakeDevices()

    await openPage()
    await row(phone.label)
    fireEvent.click(screen.getByTestId('device.everywhere.open'))
    fireEvent.click(await screen.findByTestId('device.everywhere.confirm'))

    await waitFor(() => expect(devices.calls).toEqual([['list'], ['everywhere']]))
    expect((screen.getByTestId('device.everywhere.open') as HTMLButtonElement).disabled).toBe(true)
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
  })
})
