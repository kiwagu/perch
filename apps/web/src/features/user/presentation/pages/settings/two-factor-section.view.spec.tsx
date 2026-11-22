// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { expectEachCodeMarksItsField } from '../../../../../error-fields.test-support'
import { expectFieldFacts, renderWithFacts } from '../../../../../field-facts.test-support'
import {
  RENEWED,
  rendersAt,
  STARTED,
} from '../../../application/settings/settings-machine/__fixtures__/screen'

import { TwoFactorSectionView, type TwoFactorSectionViewProps } from './two-factor-section.view'

const SECTION = 'user.settings.two-factor.section'
const KEY_CELL = 'user.settings.two-factor.key-cell'
const CODES_CELL = 'user.settings.two-factor.codes-cell'
const ERROR = 'user.settings.two-factor.error'
const PASSWORD = 'user.settings.two-factor.password-input'
const CODE = 'user.settings.two-factor.code-input'
const ENABLE = 'user.settings.two-factor.enable-button'
const DISABLE = 'user.settings.two-factor.disable-button'
const RENEW = 'user.settings.two-factor.renew-codes-button'
const CONFIRM = 'user.settings.two-factor.confirm-button'
const STOP = 'user.settings.two-factor.stop-button'
const HIDE = 'user.settings.two-factor.hide-codes-button'
const ON_BADGE = 'user.settings.two-factor.on-badge'
const OFF_BADGE = 'user.settings.two-factor.off-badge'

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement
const button = (testId: string) => screen.getByTestId(testId) as HTMLButtonElement
const has = (testId: string) => screen.queryByTestId(testId) !== null

function renderView(props: Partial<TwoFactorSectionViewProps> = {}) {
  const handlers = {
    onPassword: vi.fn(),
    onCode: vi.fn(),
    onEnable: vi.fn(() => Promise.resolve(true)),
    onDisable: vi.fn(),
    onRenew: vi.fn(),
    onConfirm: vi.fn(() => Promise.resolve(true)),
    onStop: vi.fn(),
    onHideCodes: vi.fn(),
  }

  renderWithFacts(
    <TwoFactorSectionView
      factor={{ status: 'ready', enabled: false }}
      renders={rendersAt('idle')}
      can={() => true}
      password=""
      code=""
      {...handlers}
      {...props}
    />,
  )

  return handlers
}

/** The key step: the key shown, waiting for a code of it. */
const atTheKey: Partial<TwoFactorSectionViewProps> = {
  renders: rendersAt('confirming'),
  start: STARTED,
}

describe('TwoFactorSectionView, as the section reads', () => {
  it.each([
    [{ status: 'loading' }, 'loading'],
    [{ status: 'error' }, 'error'],
    [{ status: 'ready', enabled: false }, 'ready'],
    [{ status: 'ready', enabled: true }, 'ready'],
  ] as const)('is %j while its data is %s', (factor, state) => {
    renderView({ factor })

    expect(screen.getByTestId(SECTION).getAttribute('data-state')).toBe(state)
  })

  it('shows no control and no badge before the second factor is read, nor when it could not be', () => {
    for (const status of ['loading', 'error'] as const) {
      renderView({ factor: { status } })

      for (const anchor of [ON_BADGE, OFF_BADGE, PASSWORD, ENABLE, DISABLE, RENEW]) {
        expect(has(anchor), `${anchor} while ${status}`).toBe(false)
      }

      cleanup()
    }
  })

  it('says so when it could not be read', () => {
    renderView({ factor: { status: 'error' } })

    expect(screen.getByRole('alert').textContent).toBe('The second factor could not be read.')
  })

  it('marks it off and offers to turn it on, with the password it asks first', () => {
    renderView()

    expect(has(OFF_BADGE)).toBe(true)
    expect(has(ON_BADGE)).toBe(false)
    expect(has(ENABLE)).toBe(true)
    expect(has(DISABLE) || has(RENEW)).toBe(false)
    expect(input(PASSWORD).type).toBe('password')
    expect(screen.getByTestId(`${PASSWORD}.visibility-button`)).toBeTruthy()
  })

  it('marks it on and offers to turn it off or renew the codes', () => {
    renderView({ factor: { status: 'ready', enabled: true } })

    expect(has(ON_BADGE)).toBe(true)
    expect(has(OFF_BADGE)).toBe(false)
    expect(has(DISABLE) && has(RENEW) && has(PASSWORD)).toBe(true)
    expect(has(ENABLE)).toBe(false)
  })

  it('gives its fields what the contract says of them', () => {
    renderView({ ...atTheKey })
    renderView()

    expect(new Set(expectFieldFacts(document.body))).toEqual(new Set([CODE, PASSWORD]))
  })
})

describe('TwoFactorSectionView, the idle controls', () => {
  it('tells each keystroke of the password, and turns it on by the form', () => {
    const { onPassword, onEnable } = renderView()

    fireEvent.change(input(PASSWORD), { target: { value: 'Secret-ann1' } })
    fireEvent.submit(button(ENABLE).closest('form') ?? expect.unreachable('the form'))

    expect(onPassword).toHaveBeenCalledWith('Secret-ann1')
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  it('turns it off and renews the codes on their own presses', () => {
    const { onDisable, onRenew } = renderView({ factor: { status: 'ready', enabled: true } })

    fireEvent.click(button(DISABLE))
    fireEvent.click(button(RENEW))

    expect(onDisable).toHaveBeenCalledTimes(1)
    expect(onRenew).toHaveBeenCalledTimes(1)
  })

  it('enables each button exactly while the flow takes its event, with the password as typed', () => {
    const can = vi.fn((event: { readonly type: string }) => event.type !== DISABLE)

    renderView({ factor: { status: 'ready', enabled: true }, password: 'Secret-ann1', can })

    expect(button(DISABLE).disabled).toBe(true)
    expect(button(RENEW).disabled).toBe(false)
    expect(can).toHaveBeenCalledWith({ type: DISABLE, password: 'Secret-ann1' })
    expect(can).toHaveBeenCalledWith({ type: RENEW, password: 'Secret-ann1' })
  })

  it('shows them only in the states that render them', () => {
    for (const state of ['confirming', 'turning-on', 'codes']) {
      renderView({ renders: rendersAt(state), start: STARTED, backupCodes: RENEWED })

      for (const anchor of [PASSWORD, ENABLE, DISABLE, RENEW]) {
        expect(has(anchor), `${anchor} in ${state}`).toBe(false)
      }

      cleanup()
    }
  })
})

describe('TwoFactorSectionView, the key step', () => {
  it('shows the key as text to type, and a QR beside it that carries the same key', () => {
    renderView({ ...atTheKey })

    expect(screen.getByTestId(KEY_CELL).textContent).toBe(STARTED.key)

    const qr = screen.getByRole('img', { name: 'QR code of the key' })

    expect(qr.querySelector('svg')).not.toBeNull()
    expect(qr.contains(screen.getByTestId(KEY_CELL))).toBe(false)
  })

  it('says the QR could not be drawn, the key still shown to type', () => {
    renderView({ ...atTheKey, start: { key: STARTED.key, qr: undefined } })

    expect(screen.getByTestId(KEY_CELL).textContent).toBe(STARTED.key)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(
      'The QR code could not be drawn. Type the key in your app instead.',
    )
  })

  it('takes the code by the form, telling each keystroke, and stops turning it on', () => {
    const { onCode, onConfirm, onStop } = renderView({ ...atTheKey })

    fireEvent.change(input(CODE), { target: { value: '123456' } })
    fireEvent.submit(button(CONFIRM).closest('form') ?? expect.unreachable('the form'))
    fireEvent.click(button(STOP))

    expect(input(CODE).autocomplete).toBe('one-time-code')
    expect(onCode).toHaveBeenCalledWith('123456')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(button(STOP).type).toBe('button')
  })

  it('enables the confirmation and the stop exactly while the flow takes their events', () => {
    const can = vi.fn((event: { readonly type: string }) => event.type === STOP)

    renderView({ ...atTheKey, code: '123456', can })

    expect(button(CONFIRM).disabled).toBe(true)
    expect(button(STOP).disabled).toBe(false)
    expect(can).toHaveBeenCalledWith({ type: CONFIRM, code: '123456' })
  })

  it('shows the key step only while the flow renders it', () => {
    renderView({ start: STARTED })

    for (const anchor of [KEY_CELL, CODE, CONFIRM, STOP]) {
      expect(has(anchor), anchor).toBe(false)
    }
  })
})

describe('TwoFactorSectionView, the backup codes', () => {
  it('lists the ten codes one per line, once, with the button that hides them', () => {
    const { onHideCodes } = renderView({
      renders: rendersAt('codes'),
      backupCodes: STARTED.backupCodes,
    })

    expect(screen.getByTestId(CODES_CELL).textContent?.split('\n')).toEqual(STARTED.backupCodes)

    fireEvent.click(button(HIDE))

    expect(onHideCodes).toHaveBeenCalledTimes(1)
  })

  it('shows them while the section is read again, whatever that read answers', () => {
    renderView({
      renders: rendersAt('codes'),
      backupCodes: STARTED.backupCodes,
      factor: { status: 'error' },
    })

    expect(has(CODES_CELL)).toBe(true)
  })

  it('shows none while the flow does not render them', () => {
    renderView({ backupCodes: STARTED.backupCodes })

    expect(has(CODES_CELL) || has(HIDE)).toBe(false)
  })
})

describe('TwoFactorSectionView, the failures', () => {
  const FAILURES: Readonly<Record<string, string>> = {
    'invalid-credentials': 'data:INVALID_CREDENTIALS',
    'invalid-code': 'data:INVALID_CODE',
  }

  it("marks the field each code concerns, as the screen's fields say, and no other", () => {
    expectEachCodeMarksItsField(ERROR, (code) =>
      renderView({
        error: FAILURES[code],
        ...(code === 'invalid-code' ? atTheKey : {}),
      }),
    )
  })

  it('says the code of a code that is no code as it says a wrong one', () => {
    renderView({ ...atTheKey, error: 'sign-in:CODE_INVALID' })

    expect(screen.getByTestId(ERROR).getAttribute('data-code')).toBe('invalid-code')
  })

  it.each([
    ['data:TWO_FACTOR_CHANGED', 'two-factor-changed'],
    ['data:RATE_LIMITED', 'rate-limited'],
    ['data:OFFLINE', 'failed'],
  ])('says %s above the controls, marking no field', (failure, code) => {
    renderView({ error: failure })

    const error = screen.getByTestId(ERROR)

    expect(error.getAttribute('data-code')).toBe(code)
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
    expect(within(error).queryByRole('textbox')).toBeNull()
  })

  it('says a failure once even when the field it concerns is not rendered', () => {
    renderView({
      renders: rendersAt('codes'),
      backupCodes: STARTED.backupCodes,
      error: 'data:INVALID_CREDENTIALS',
    })

    expect(screen.getAllByTestId(ERROR)).toHaveLength(1)
  })

  it('shows no failure before one happens', () => {
    renderView()

    expect(has(ERROR)).toBe(false)
  })
})
