// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

import {
  ADDED_AT,
  FakePasskeys,
  laptopKey,
  securityKey,
} from '../../../../../platform/__fixtures__/passkeys'
import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { memoryTheme } from '../../../../../platform/__fixtures__/theme'
import {
  FACTOR_PASSWORD,
  FakeTwoFactor,
  KEY,
  RENEWED_CODES,
  RIGHT_CODE,
  refusedWith,
  START_CODES,
} from '../../../../../platform/__fixtures__/two-factor'
import { englishCatalog } from '../../../../../platform/catalogs'
import { ConfirmGuardContext } from '../../../../../platform/confirm-guard.port'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'
import { SettingsWritesContext } from '../../../../../platform/settings-writes'
import { ThemeContext } from '../../../../../platform/theme'
import { PASSKEYS_SERVICE, PasskeysService } from '../../../application/passkeys.service'
import { qrSvg } from '../../../application/qr-svg.policy'
import { TWO_FACTOR_SERVICE, TwoFactorService } from '../../../application/two-factor.service'

import { SettingsContainer } from './settings.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

/** What a change of the password answers. */
type ChangeAnswer = ReturnType<SessionPort['changePassword']>

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

/** Whether a field of the page holds unsaved input, as the frame's leave guard reads it. */
let unsavedNow = false

function UnsavedProbe() {
  unsavedNow = useUnsavedInput()

  return null
}

/** What a request for the account's deletion answers. */
type DeletionAnswer = ReturnType<SessionPort['requestAccountDeletion']>

/** The gateway's second factor and passkeys the page runs against, and how it draws a key's QR. */
interface World {
  readonly twoFactor?: FakeTwoFactor
  readonly passkeys?: FakePasskeys
  readonly draw?: (uri: string) => Promise<string>
  /** How the frame answers the question before a destructive control; yes at once when left out. */
  readonly confirm?: (control: string) => Promise<boolean>
}

function open(
  answer: () => ChangeAnswer,
  deletion: () => DeletionAnswer = () => okAsync(undefined),
  world: World = {},
) {
  const twoFactor = world.twoFactor ?? new FakeTwoFactor()
  const passkeys = world.passkeys ?? new FakePasskeys()
  const changePassword = vi.fn((_current: string, _password: string) => answer())
  const requestAccountDeletion = vi.fn((_password: string) => deletion())
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => ann,
    changePassword,
    requestAccountDeletion,
  }
  const TestModule = defineModule({
    id: 'test',
    declarations: { Settings: SettingsContainer },
    routes: [{ path: '/settings', page: 'Settings', guard: 'authenticated', roles: ['identity'] }],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: ['/settings'] }),
  })

  const services = fakeServices(session)

  services.container
    .singleton(TWO_FACTOR_SERVICE, () => new TwoFactorService(twoFactor, world.draw ?? qrSvg))
    .singleton(PASSKEYS_SERVICE, () => new PasskeysService(passkeys))

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={services}>
        <ThemeContext.Provider value={memoryTheme()}>
          <SettingsWritesContext.Provider
            value={{ locale: { writing: () => () => {} }, theme: { writing: () => () => {} } }}
          >
            <ConfirmGuardContext.Provider
              value={{ before: world.confirm ?? (() => Promise.resolve(true)) }}
            >
              <UnsavedInputScope>
                <RouterProvider router={router} />
                <UnsavedProbe />
              </UnsavedInputScope>
            </ConfirmGuardContext.Provider>
          </SettingsWritesContext.Provider>
        </ThemeContext.Provider>
      </ServicesProvider>
    </I18nProvider>,
  )

  return { changePassword, requestAccountDeletion, twoFactor, passkeys }
}

const CURRENT = 'user.settings.password.current-password-input'
const NEW = 'user.settings.password.new-password-input'
const CONFIRMATION = 'user.settings.password.password-confirmation-input'
const DELETION_PASSWORD = 'user.settings.deletion.password-input'

const value = (testId: string) => (screen.getByTestId(testId) as HTMLInputElement).value

/** Types the current password and the new one twice, and saves. */
async function change(): Promise<void> {
  await screen.findByTestId('user.settings.password.form')

  for (const [testId, typed] of [
    [CURRENT, 'Secret-old1'],
    [NEW, 'Secret-new1'],
    [CONFIRMATION, 'Secret-new1'],
  ] as const) {
    fireEvent.change(screen.getByTestId(testId), { target: { value: typed } })
  }

  expect(unsavedNow).toBe(true)
  await act(async () => fireEvent.click(screen.getByTestId('user.settings.password.save-button')))
}

describe('SettingsContainer', () => {
  it('changes the password, then empties the form, which holds no input any more', async () => {
    const { changePassword } = open(() => okAsync(undefined))

    await change()

    await waitFor(() => expect(value(CURRENT)).toBe(''))
    expect(changePassword).toHaveBeenCalledWith('Secret-old1', 'Secret-new1')
    expect(value(NEW)).toBe('')
    expect(value(CONFIRMATION)).toBe('')
    await waitFor(() => expect(unsavedNow).toBe(false))
  })

  it('keeps the form as typed when the change is refused, under the field its code concerns', async () => {
    open(() => errAsync({ code: 'data:INVALID_CREDENTIALS' as const, message: 'wrong' }))

    await change()

    await waitFor(() =>
      expect(screen.getByTestId('user.settings.password.error').getAttribute('data-code')).toBe(
        'invalid-credentials',
      ),
    )
    expect(value(CURRENT)).toBe('Secret-old1')
    expect(value(NEW)).toBe('Secret-new1')
    expect(unsavedNow).toBe(true)
  })

  it('shows the deletion form with its anchors, and no message before a send', async () => {
    open(() => okAsync(undefined))

    for (const anchor of [
      'user.settings.deletion.form',
      'user.settings.deletion.password-input',
      'user.settings.deletion.send-button',
    ]) {
      expect(await screen.findByTestId(anchor)).toBeTruthy()
    }

    expect(screen.queryByTestId('user.settings.deletion.message')).toBeNull()
    expect(screen.queryByTestId('user.settings.deletion.error')).toBeNull()
  })

  it('sends the deletion link with the password, says so, then empties the password', async () => {
    const { requestAccountDeletion } = open(() => okAsync(undefined))

    await screen.findByTestId('user.settings.deletion.form')
    fireEvent.change(screen.getByTestId(DELETION_PASSWORD), { target: { value: 'Secret-ann1' } })
    expect(unsavedNow).toBe(true)
    await act(async () => fireEvent.click(screen.getByTestId('user.settings.deletion.send-button')))

    await waitFor(() =>
      expect(screen.getByTestId('user.settings.deletion.message').getAttribute('data-code')).toBe(
        'check-your-mail',
      ),
    )
    expect(requestAccountDeletion).toHaveBeenCalledWith('Secret-ann1')
    await waitFor(() => expect(value(DELETION_PASSWORD)).toBe(''))
    await waitFor(() => expect(unsavedNow).toBe(false))
  })

  it('keeps the password as typed when the request is refused, and says why', async () => {
    open(
      () => okAsync(undefined),
      () => errAsync({ code: 'data:INVALID_CREDENTIALS' as const, message: 'wrong' }),
    )

    await screen.findByTestId('user.settings.deletion.form')
    fireEvent.change(screen.getByTestId(DELETION_PASSWORD), { target: { value: 'Wrong-pass1' } })
    await act(async () => fireEvent.click(screen.getByTestId('user.settings.deletion.send-button')))

    await waitFor(() =>
      expect(screen.getByTestId('user.settings.deletion.error').getAttribute('data-code')).toBe(
        'invalid-credentials',
      ),
    )
    expect(value(DELETION_PASSWORD)).toBe('Wrong-pass1')
    expect(screen.queryByTestId('user.settings.deletion.message')).toBeNull()
  })
})

const FACTOR = {
  section: 'user.settings.two-factor.section',
  onBadge: 'user.settings.two-factor.on-badge',
  offBadge: 'user.settings.two-factor.off-badge',
  password: 'user.settings.two-factor.password-input',
  enable: 'user.settings.two-factor.enable-button',
  disable: 'user.settings.two-factor.disable-button',
  renew: 'user.settings.two-factor.renew-codes-button',
  key: 'user.settings.two-factor.key-cell',
  code: 'user.settings.two-factor.code-input',
  confirm: 'user.settings.two-factor.confirm-button',
  stop: 'user.settings.two-factor.stop-button',
  codes: 'user.settings.two-factor.codes-cell',
  hide: 'user.settings.two-factor.hide-codes-button',
  error: 'user.settings.two-factor.error',
} as const

const typed = (testId: string, text: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value: text } })
const pressed = (testId: string) => act(async () => fireEvent.click(screen.getByTestId(testId)))
const errorCode = () => screen.getByTestId(FACTOR.error).getAttribute('data-code')

/** The page with the second factor read as off, its enable button on screen. */
async function openOff(world: World = {}) {
  const opened = open(
    () => okAsync(undefined),
    () => okAsync(undefined),
    world,
  )

  await screen.findByTestId(FACTOR.offBadge)

  return opened
}

/** Turns the second factor on up to the key step. */
async function askTheKey(): Promise<void> {
  typed(FACTOR.password, FACTOR_PASSWORD)
  await pressed(FACTOR.enable)
  await screen.findByTestId(FACTOR.key)
}

describe('SettingsContainer, the second factor', () => {
  it('reads whether it is on when the page opens, and offers to turn it on', async () => {
    const { twoFactor } = await openOff()

    expect(screen.getByTestId(FACTOR.section).getAttribute('data-state')).toBe('ready')
    expect(screen.queryByTestId(FACTOR.onBadge)).toBeNull()
    expect(twoFactor.calls).toEqual([['read']])
  })

  it('offers to turn it off and renew the codes when it is on', async () => {
    const twoFactor = new FakeTwoFactor()

    twoFactor.enabled = true
    open(() => okAsync(undefined), undefined, { twoFactor })

    expect(await screen.findByTestId(FACTOR.onBadge)).toBeTruthy()
    expect(screen.getByTestId(FACTOR.disable)).toBeTruthy()
    expect(screen.getByTestId(FACTOR.renew)).toBeTruthy()
    expect(screen.queryByTestId(FACTOR.enable)).toBeNull()
  })

  it('says so when it could not be read', async () => {
    const twoFactor = new FakeTwoFactor()

    twoFactor.refusal = refusedWith('data:OFFLINE')
    open(() => okAsync(undefined), undefined, { twoFactor })

    await waitFor(() =>
      expect(screen.getByTestId(FACTOR.section).getAttribute('data-state')).toBe('error'),
    )
    expect(screen.queryByTestId(FACTOR.enable)).toBeNull()
  })

  it('turns it on: the key with its QR, then a code of it, then the ten backup codes, once', async () => {
    const { twoFactor } = await openOff()

    await askTheKey()

    expect(screen.getByTestId(FACTOR.key).textContent).toBe(KEY)
    expect(await screen.findByRole('img', { name: 'QR code of the key' })).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'QR code of the key' }).querySelector('svg'),
    ).toBeTruthy()
    // The key step has no password and no turning on or off.
    expect(screen.queryByTestId(FACTOR.password)).toBeNull()
    expect(twoFactor.enabled).toBe(false)

    typed(FACTOR.code, RIGHT_CODE)
    await pressed(FACTOR.confirm)

    expect((await screen.findByTestId(FACTOR.codes)).textContent?.split('\n')).toEqual(START_CODES)
    expect(screen.queryByTestId(FACTOR.key)).toBeNull()
    expect(twoFactor.enabled).toBe(true)
    // The section reads again: it is on now.
    await waitFor(() => expect(twoFactor.calls.filter(([call]) => call === 'read')).toHaveLength(2))

    await pressed(FACTOR.hide)

    expect(screen.queryByTestId(FACTOR.codes)).toBeNull()
    expect(await screen.findByTestId(FACTOR.onBadge)).toBeTruthy()
    expect(screen.getByTestId(FACTOR.disable)).toBeTruthy()
  })

  it('keeps the password as typed under its field when the password is wrong, and shows no key', async () => {
    await openOff()

    typed(FACTOR.password, 'Wrong-pass1')
    await pressed(FACTOR.enable)

    await waitFor(() => expect(errorCode()).toBe('invalid-credentials'))
    expect(value(FACTOR.password)).toBe('Wrong-pass1')
    expect(screen.queryByTestId(FACTOR.key)).toBeNull()
    expect(unsavedNow).toBe(true)
  })

  it('says a wrong code under its field, keeping the key, and takes the right one next', async () => {
    const { twoFactor } = await openOff()

    await askTheKey()
    typed(FACTOR.code, '000000')
    await pressed(FACTOR.confirm)

    await waitFor(() => expect(errorCode()).toBe('invalid-code'))
    expect(screen.getByTestId(FACTOR.key).textContent).toBe(KEY)
    expect(value(FACTOR.code)).toBe('000000')

    typed(FACTOR.code, RIGHT_CODE)
    await pressed(FACTOR.confirm)

    await screen.findByTestId(FACTOR.codes)
    expect(screen.queryByTestId(FACTOR.error)).toBeNull()
    expect(twoFactor.enabled).toBe(true)
  })

  it('stops turning it on: the key goes, the code is emptied, the second factor stays off', async () => {
    const { twoFactor } = await openOff()

    await askTheKey()
    typed(FACTOR.code, '123')
    await pressed(FACTOR.stop)

    expect(screen.queryByTestId(FACTOR.key)).toBeNull()
    expect(screen.getByTestId(FACTOR.offBadge)).toBeTruthy()
    expect(value(FACTOR.password)).toBe('')
    expect(twoFactor.enabled).toBe(false)

    // A new key, a new code field.
    await askTheKey()
    expect(value(FACTOR.code)).toBe('')
  })

  it('refuses the key when its QR cannot be drawn: the failed error, no key step, the factor off', async () => {
    const { twoFactor } = await openOff({
      draw: () => Promise.reject(new Error('the chunk did not load')),
    })

    typed(FACTOR.password, FACTOR_PASSWORD)
    await pressed(FACTOR.enable)

    await waitFor(() => expect(errorCode()).toBe('failed'))
    for (const anchor of [FACTOR.key, FACTOR.code, FACTOR.confirm, FACTOR.stop]) {
      expect(screen.queryByTestId(anchor), anchor).toBeNull()
    }

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId(FACTOR.offBadge)).toBeTruthy()
    expect(twoFactor.enabled).toBe(false)
    expect(twoFactor.calls.filter(([call]) => call === 'confirm')).toEqual([])
    // The password stays as typed, to ask again.
    expect(value(FACTOR.password)).toBe(FACTOR_PASSWORD)
  })

  it('reads it as it is now when it was turned on from another device meanwhile', async () => {
    const { twoFactor } = await openOff()

    twoFactor.enabled = true
    typed(FACTOR.password, FACTOR_PASSWORD)
    await pressed(FACTOR.enable)

    await waitFor(() => expect(errorCode()).toBe('two-factor-changed'))
    expect(await screen.findByTestId(FACTOR.onBadge)).toBeTruthy()
    expect(value(FACTOR.password)).toBe('')
  })

  it('leaves the key and reads it as it is now when the key was replaced from another device', async () => {
    const { twoFactor } = await openOff()

    await askTheKey()
    // Another device asked its own key: the page's one is stale, and the factor still off.
    expect((await twoFactor.enable(FACTOR_PASSWORD)).isOk()).toBe(true)
    typed(FACTOR.code, RIGHT_CODE)
    await pressed(FACTOR.confirm)

    await waitFor(() => expect(errorCode()).toBe('two-factor-changed'))
    expect(screen.queryByTestId(FACTOR.key)).toBeNull()
    expect(await screen.findByTestId(FACTOR.offBadge)).toBeTruthy()
  })

  it('turns it off with the password, then marks it off', async () => {
    const twoFactor = new FakeTwoFactor()

    twoFactor.enabled = true
    open(() => okAsync(undefined), undefined, { twoFactor })
    await screen.findByTestId(FACTOR.onBadge)

    typed(FACTOR.password, FACTOR_PASSWORD)
    await pressed(FACTOR.disable)

    expect(await screen.findByTestId(FACTOR.offBadge)).toBeTruthy()
    expect(twoFactor.enabled).toBe(false)
    expect(value(FACTOR.password)).toBe('')
  })

  it('renews the codes with the password and shows the ten new ones once', async () => {
    const twoFactor = new FakeTwoFactor()

    twoFactor.enabled = true
    open(() => okAsync(undefined), undefined, { twoFactor })
    await screen.findByTestId(FACTOR.onBadge)

    typed(FACTOR.password, FACTOR_PASSWORD)
    await pressed(FACTOR.renew)

    expect((await screen.findByTestId(FACTOR.codes)).textContent?.split('\n')).toEqual(
      RENEWED_CODES,
    )

    await pressed(FACTOR.hide)

    expect(screen.queryByTestId(FACTOR.codes)).toBeNull()
    expect(screen.getByTestId(FACTOR.onBadge)).toBeTruthy()
  })
})

/** The page with the second factor read as on, its disable and renew buttons on screen. */
async function openOn(): Promise<FakeTwoFactor> {
  const twoFactor = new FakeTwoFactor()

  twoFactor.enabled = true
  open(() => okAsync(undefined), undefined, { twoFactor })
  await screen.findByTestId(FACTOR.onBadge)

  return twoFactor
}

const state = () => screen.getByTestId(FACTOR.section).getAttribute('data-state')
const shown = (...anchors: readonly string[]) => anchors.map((anchor) => has(anchor))
const has = (testId: string) => screen.queryByTestId(testId) !== null
/** Lets the read the page waits for answer. */
const released = (release: () => void) => act(async () => release())

describe('SettingsContainer, a blank password', () => {
  it('sends no request for any of the three presses', async () => {
    const off = await openOff()

    await pressed(FACTOR.enable)

    expect(off.twoFactor.calls).toEqual([['read']])
    expect(screen.queryByTestId(FACTOR.key)).toBeNull()
    cleanup()

    const on = await openOn()

    await pressed(FACTOR.disable)
    await pressed(FACTOR.renew)

    expect(on.calls).toEqual([['read']])
    expect(screen.queryByTestId(FACTOR.codes)).toBeNull()
    expect(screen.getByTestId(FACTOR.onBadge)).toBeTruthy()
  })

  it('asks the password the field holds once it is typed', async () => {
    const on = await openOn()

    typed(FACTOR.password, FACTOR_PASSWORD)
    await pressed(FACTOR.renew)

    expect(await screen.findByTestId(FACTOR.codes)).toBeTruthy()
    expect(on.calls).toContainEqual(['renew', FACTOR_PASSWORD])
  })
})

describe('SettingsContainer, the second factor while it is read again', () => {
  it('shows the codes made without a status or an action until the read answers, then the new status', async () => {
    const { twoFactor } = await openOff()

    await askTheKey()

    const release = twoFactor.holdReads()

    typed(FACTOR.code, RIGHT_CODE)
    await pressed(FACTOR.confirm)

    expect(await screen.findByTestId(FACTOR.codes)).toBeTruthy()
    // The old answer (off) is not shown next to the codes while the new one is awaited.
    expect(state()).toBe('loading')
    expect(
      shown(FACTOR.offBadge, FACTOR.onBadge, FACTOR.enable, FACTOR.disable, FACTOR.renew),
    ).toEqual([false, false, false, false, false])

    await released(release)

    expect(await screen.findByTestId(FACTOR.onBadge)).toBeTruthy()
    expect(state()).toBe('ready')
    // The codes stay while the flow shows them, and no action comes with them.
    expect(has(FACTOR.codes)).toBe(true)
    expect(shown(FACTOR.enable, FACTOR.disable, FACTOR.renew)).toEqual([false, false, false])

    await pressed(FACTOR.hide)

    expect(shown(FACTOR.disable, FACTOR.renew, FACTOR.enable)).toEqual([true, true, false])
  })

  it('does not offer to turn it on again when the codes are hidden before the read answers', async () => {
    const { twoFactor } = await openOff()

    await askTheKey()

    const release = twoFactor.holdReads()

    typed(FACTOR.code, RIGHT_CODE)
    await pressed(FACTOR.confirm)
    await screen.findByTestId(FACTOR.codes)
    await pressed(FACTOR.hide)

    expect(state()).toBe('loading')
    expect(
      shown(FACTOR.enable, FACTOR.disable, FACTOR.renew, FACTOR.password, FACTOR.offBadge),
    ).toEqual([false, false, false, false, false])

    await released(release)

    expect(await screen.findByTestId(FACTOR.onBadge)).toBeTruthy()
    expect(shown(FACTOR.disable, FACTOR.renew, FACTOR.enable)).toEqual([true, true, false])
  })

  it('does not offer to renew the codes while it is read again after turning it off', async () => {
    const twoFactor = await openOn()
    const release = twoFactor.holdReads()

    typed(FACTOR.password, FACTOR_PASSWORD)
    await pressed(FACTOR.disable)

    await waitFor(() => expect(state()).toBe('loading'))
    expect(twoFactor.enabled).toBe(false)
    expect(
      shown(FACTOR.onBadge, FACTOR.offBadge, FACTOR.disable, FACTOR.renew, FACTOR.enable),
    ).toEqual([false, false, false, false, false])

    await released(release)

    expect(await screen.findByTestId(FACTOR.offBadge)).toBeTruthy()
    expect(shown(FACTOR.enable, FACTOR.disable, FACTOR.renew)).toEqual([true, false, false])
  })
})

const PASSKEYS = {
  list: 'user.settings.passkeys.list',
  item: 'user.settings.passkeys.passkey-item',
  remove: 'user.settings.passkeys.remove-button',
  add: 'user.settings.passkeys.add-button',
  error: 'user.settings.passkeys.error',
} as const

const ids = () => screen.getAllByTestId(PASSKEYS.item).map((item) => item.getAttribute('data-id'))

describe('SettingsContainer, the passkeys', () => {
  it('lists them, the earliest first, when the page opens', async () => {
    const { passkeys } = open(() => okAsync(undefined))

    await waitFor(() =>
      expect(screen.getByTestId(PASSKEYS.list).getAttribute('data-state')).toBe('ready'),
    )
    expect(ids()).toEqual([laptopKey.id, securityKey.id])
    expect(passkeys.calls).toEqual([['list']])
  })

  it('says so when there is none, and when they could not be read', async () => {
    const none = new FakePasskeys()

    none.rows = []
    open(() => okAsync(undefined), undefined, { passkeys: none })
    await waitFor(() =>
      expect(screen.getByTestId(PASSKEYS.list).getAttribute('data-state')).toBe('empty'),
    )
    cleanup()

    const unreadable = new FakePasskeys()

    unreadable.refusal = refusedWith('data:OFFLINE')
    open(() => okAsync(undefined), undefined, { passkeys: unreadable })
    await waitFor(() =>
      expect(screen.getByTestId(PASSKEYS.list).getAttribute('data-state')).toBe('error'),
    )
  })

  it('adds one the browser makes, then lists it', async () => {
    const { passkeys } = open(() => okAsync(undefined))

    await screen.findAllByTestId(PASSKEYS.item)
    await pressed(PASSKEYS.add)

    await waitFor(() => expect(screen.getAllByTestId(PASSKEYS.item)).toHaveLength(3))
    expect(passkeys.calls).toEqual([['list'], ['add'], ['list']])
    expect(screen.queryByTestId(PASSKEYS.error)).toBeNull()
    expect(screen.getAllByTestId('user.settings.passkeys.added-cell')[2]?.textContent).toContain(
      String(ADDED_AT.getFullYear()),
    )
  })

  it('says a window closed adds nothing, and leaves the list as it was', async () => {
    const passkeys = new FakePasskeys()

    open(() => okAsync(undefined), undefined, { passkeys })
    await screen.findAllByTestId(PASSKEYS.item)
    passkeys.refusal = refusedWith('data:PASSKEY_CANCELLED')
    await pressed(PASSKEYS.add)

    await waitFor(() =>
      expect(screen.getByTestId(PASSKEYS.error).getAttribute('data-code')).toBe(
        'passkey-cancelled',
      ),
    )
    expect(ids()).toEqual([laptopKey.id, securityKey.id])
  })

  it('removes the passkey of its row, then lists the rest', async () => {
    const { passkeys } = open(() => okAsync(undefined))

    await screen.findAllByTestId(PASSKEYS.item)
    await act(async () =>
      fireEvent.click(
        within(screen.getAllByTestId(PASSKEYS.item)[0] as HTMLElement).getByTestId(PASSKEYS.remove),
      ),
    )

    await waitFor(() => expect(ids()).toEqual([securityKey.id]))
    expect(passkeys.calls).toEqual([['list'], ['remove', laptopKey.id], ['list']])
  })

  it('asks the frame before it removes a passkey, and removes nothing when the answer is no', async () => {
    const asked: string[] = []
    const passkeys = new FakePasskeys()

    open(() => okAsync(undefined), undefined, {
      passkeys,
      confirm: (control) => {
        asked.push(control)

        return Promise.resolve(false)
      },
    })
    await screen.findAllByTestId(PASSKEYS.item)
    await act(async () =>
      fireEvent.click(
        within(screen.getAllByTestId(PASSKEYS.item)[0] as HTMLElement).getByTestId(PASSKEYS.remove),
      ),
    )

    expect(asked).toEqual([PASSKEYS.remove])
    expect(passkeys.calls).toEqual([['list']])
    expect(ids()).toEqual([laptopKey.id, securityKey.id])
  })

  it('says a removal that failed, and lists the passkeys as they are now', async () => {
    const passkeys = new FakePasskeys()

    open(() => okAsync(undefined), undefined, { passkeys })
    await screen.findAllByTestId(PASSKEYS.item)
    // Another device removed it first.
    passkeys.rows = [securityKey]
    await act(async () =>
      fireEvent.click(
        within(screen.getAllByTestId(PASSKEYS.item)[0] as HTMLElement).getByTestId(PASSKEYS.remove),
      ),
    )

    await waitFor(() =>
      expect(screen.getByTestId(PASSKEYS.error).getAttribute('data-code')).toBe('failed'),
    )
    await waitFor(() => expect(ids()).toEqual([securityKey.id]))
  })
})
