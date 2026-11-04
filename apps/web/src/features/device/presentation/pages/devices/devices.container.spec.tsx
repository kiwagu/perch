// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'

import { FakeDevices, offline, phone, rejected } from '../../../../../platform/__fixtures__/devices'
import { memoryInstall } from '../../../../../platform/__fixtures__/install'
import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { memoryTheme } from '../../../../../platform/__fixtures__/theme'
import { englishCatalog } from '../../../../../platform/catalogs'
import { DEVICES } from '../../../../../platform/devices.port'
import { InstallContext } from '../../../../../platform/install'
import { NoticeProvider } from '../../../../../platform/notices'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionNotice } from '../../../../../platform/session.port'
import { ThemeContext } from '../../../../../platform/theme'
import { openedFrame } from '../../../../app-shell/presentation/shell/__fixtures__/frame'
import { NOTICE_TEXTS } from '../../../../app-shell/presentation/shell/notice-texts'
import { ShellContainer } from '../../../../app-shell/presentation/shell/shell.container'
import { ShellFrameContext } from '../../../../app-shell/presentation/shell/shell-frame'
import { DeviceModule } from '../../../device.module'
import en from '../../i18n/device.en.json'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob = { id: identityIdFactory.create(), email: 'bob@example.test' }

let devices: FakeDevices

/** How many times the page had the session sign this device out. */
let signedOutHere = 0

/** The words the page left for the sign-in page, oldest first. */
let leftForSignIn: SessionNotice[] = []

/** Who is signed in on the browser, and who hears the account change. */
let account: typeof ann | undefined = ann
const accountListeners = new Set<(user: typeof ann | undefined) => void>()

/** The browser's account changes to `next`, as this tab or another one changes it. */
function tell(next: typeof ann | undefined): void {
  account = next

  for (const listener of accountListeners) {
    listener(next)
  }
}

/** Ann's account goes away, as a sign-out here or from another device leaves it. */
function signOut(): void {
  tell(undefined)
}

/** The devices page in the application's frame, for Ann signed in, over `devices`. */
async function openPage(): Promise<void> {
  signedOutHere = 0
  leftForSignIn = []
  account = ann
  accountListeners.clear()

  const session = {
    ...fakeSession().session,
    leaveNotice: (notice: SessionNotice) => {
      leftForSignIn.push(notice)
    },
    current: () => account,
    subscribe: (listener: (user: typeof ann | undefined) => void) => {
      accountListeners.add(listener)

      return () => {
        accountListeners.delete(listener)
      }
    },
    signingOutEverywhere: () => () => {
      signedOutHere += 1

      return okAsync(undefined)
    },
  }
  const router = createAppRouter({
    modules: [DeviceModule],
    session,
    layout: () => (
      <NoticeProvider texts={NOTICE_TEXTS}>
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
      <ThemeContext.Provider value={memoryTheme()}>
        <InstallContext.Provider value={memoryInstall()}>
          <ShellFrameContext.Provider value={openedFrame()}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </InstallContext.Provider>
      </ThemeContext.Provider>
    </I18nProvider>,
  )
  await screen.findByTestId('app-shell.nav.devices-link')
}

/** The row of the device with `label`, once the list shows it. */
async function row(label: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('device.list.session-item')

  return (
    rows.find((each) => within(each).getByTestId('device.list.label-cell').textContent === label) ??
    expect.unreachable(`a row for ${label}`)
  )
}

/** The shell's notice carries `code` and says `text`. */
async function expectNotice(code: string, text: string): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('app-shell.notice-message').getAttribute('data-code')).toBe(code),
  )
  expect(screen.getByTestId('app-shell.notice-message').textContent).toBe(text)
}

describe('DevicesContainer', () => {
  it('reads the devices when the page opens', async () => {
    devices = new FakeDevices()

    await openPage()

    expect(await screen.findAllByTestId('device.list.session-item')).toHaveLength(2)
    expect(devices.calls).toEqual([['list']])
  })

  it('signs another device out, then shows the list read again', async () => {
    devices = new FakeDevices()

    await openPage()
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke-button'))

    expect(
      await within(await row(phone.label)).findByTestId('device.list.revoked-cell'),
    ).toBeTruthy()
    expect(within(await row(phone.label)).queryByTestId('device.list.revoke-button')).toBeNull()
    expect(devices.calls).toEqual([['list'], ['revoke', phone.id], ['list']])
  })

  it('says so when the gateway refuses a sign-out, and reads the list again', async () => {
    devices = new FakeDevices()

    await openPage()
    devices.refusal = rejected('no-such-device')
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke-button'))

    await expectNotice('device-sign-out-failed', en['device.notice.sign-out-failed'])
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
    fireEvent.click(within(await row(phone.label)).getByTestId('device.list.revoke-button'))

    await expectNotice('device-sign-out-failed', en['device.notice.sign-out-failed'])
    await waitFor(async () =>
      expect(
        (
          within(await row(phone.label)).getByTestId(
            'device.list.revoke-button',
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(devices.calls).toEqual([['list'], ['revoke', phone.id]])
    await expectNotice('device-sign-out-failed', en['device.notice.sign-out-failed'])
  })

  it('says so when the devices cannot be read', async () => {
    devices = new FakeDevices()
    devices.refusal = offline()

    await openPage()

    await expectNotice('devices-read-failed', en['device.notice.read-failed'])
    expect(screen.getByTestId('device.page.status').getAttribute('data-state')).toBe('loading')
    expect(screen.getByTestId('device.page.status').textContent).toBe(en['device.page.loading'])
  })

  it('signs out everywhere once confirmed, and has the session sign this device out without waiting for its channel', async () => {
    devices = new FakeDevices()

    await openPage()
    await row(phone.label)
    fireEvent.click(screen.getByTestId('device.everywhere.open-button'))
    fireEvent.click(await screen.findByTestId('device.everywhere.dialog.confirm-button'))

    await waitFor(() => expect(signedOutHere).toBe(1))
    expect(devices.calls).toEqual([['list'], ['everywhere']])
    // The session keeps a word it left on the device's data in place of this one.
    await waitFor(() => expect(leftForSignIn).toEqual(['signed-out-elsewhere']))
  })

  it('leaves the sign-in page no word when the account that asked to sign out everywhere signs out, and another signs in, before the gateway answers', async () => {
    devices = new FakeDevices()

    let answer: () => void = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })

    devices.signOutEverywhere = () => {
      devices.calls.push(['everywhere'])

      return ResultAsync.fromSafePromise(answered)
    }

    await openPage()
    await row(phone.label)
    fireEvent.click(screen.getByTestId('device.everywhere.open-button'))
    fireEvent.click(await screen.findByTestId('device.everywhere.dialog.confirm-button'))
    await waitFor(() => expect(devices.calls).toEqual([['list'], ['everywhere']]))

    // Ann signs out and Bob signs in, in this tab or another, while the request is in flight.
    act(() => signOut())
    await waitFor(() => expect(screen.queryByTestId('device.everywhere.open-button')).toBeNull())
    act(() => tell(bob))
    await act(async () => answer())
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The page went with Ann's account: its flow ended there, and neither moved nor left a word.
    expect(screen.queryByTestId('device.everywhere.open-button')).toBeNull()
    expect(leftForSignIn).toEqual([])
  })

  it('neither reads the devices again nor says they could not be read once the account signs out', async () => {
    devices = new FakeDevices()

    await openPage()
    await row(phone.label)
    // With no account a read fails: it must not be made at all.
    devices.refusal = offline()
    act(() => signOut())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(devices.calls).toEqual([['list']])
    expect(screen.queryByTestId('app-shell.notice-message')?.getAttribute('data-code')).not.toBe(
      'devices-read-failed',
    )
  })

  it('says so when signing out everywhere fails, and lets it be asked again', async () => {
    devices = new FakeDevices()

    await openPage()
    await row(phone.label)
    devices.refusal = offline()
    fireEvent.click(screen.getByTestId('device.everywhere.open-button'))
    fireEvent.click(await screen.findByTestId('device.everywhere.dialog.confirm-button'))

    await expectNotice('device-sign-out-failed', en['device.notice.sign-out-failed'])
    expect(
      (screen.getByTestId('device.everywhere.open-button') as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(signedOutHere).toBe(0)
  })
})
