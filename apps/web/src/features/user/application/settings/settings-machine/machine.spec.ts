import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { dataError } from '@workspace/data'
import type { Locale } from '@workspace/i18n'

import type { Theme } from '../../../../../platform/theme'

import {
  createSettingsMachine,
  SETTINGS_PASSWORDS_DIFFER,
  type SettingsMachineDeps,
  type SettingsValues,
} from '.'

function screen(
  options: {
    readonly store?: () => ResultAsync<void, unknown>
    readonly changePassword?: SettingsMachineDeps['changePassword']
    readonly changeEmail?: SettingsMachineDeps['changeEmail']
  } = {},
) {
  let values: SettingsValues = { held: true, account: 'idn_ann', storingFor: undefined }
  const setTheme = vi.fn<(theme: Theme) => void>()
  const storeLocale = vi.fn<(locale: Locale) => ResultAsync<void, unknown>>(
    options.store ?? (() => okAsync(undefined)),
  )
  const actor = createActor(
    createSettingsMachine({
      values: () => values,
      setTheme,
      storeLocale: (locale) => {
        values = { ...values, storingFor: values.account }

        return storeLocale(locale)
      },
      changePassword: options.changePassword ?? (() => okAsync(undefined)),
      changeEmail: options.changeEmail ?? (() => okAsync(undefined)),
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    setTheme,
    storeLocale,
    emitted,
    set: (more: Partial<SettingsValues>) => {
      values = { ...values, ...more }
    },
  }
}

const NOT_STORED = {
  type: 'show',
  anchor: 'app-shell.notice-message',
  codes: ['locale-not-stored'],
}

describe('settings machine', () => {
  it('shows a chosen theme on the device at once', async () => {
    const settings = screen()

    settings.actor.send({ type: 'user.settings.theme-select', theme: 'dark' })

    await waitFor(settings.actor, (state) => state.matches({ viewing: { theme: 'idle' } }))
    expect(settings.setTheme).toHaveBeenCalledWith('dark')
  })

  it('speaks a chosen language at once and stores it, taking no other choice meanwhile', () => {
    const settings = screen({ store: () => new ResultAsync(new Promise(() => {})) })

    settings.actor.send({ type: 'user.settings.locale-select', locale: 'es' })

    expect(settings.emitted).toContainEqual({ type: 'speak', locale: 'es' })
    expect(settings.storeLocale).toHaveBeenCalledWith('es')
    expect(
      settings.actor.getSnapshot().can({ type: 'user.settings.locale-select', locale: 'en' }),
    ).toBe(false)
  })

  it('takes no language before the settings are on the device', () => {
    const settings = screen()

    settings.set({ held: false })

    expect(
      settings.actor.getSnapshot().can({ type: 'user.settings.locale-select', locale: 'es' }),
    ).toBe(false)
  })

  it('says a language the settings could not store, and nothing once the account left', async () => {
    const failing = screen({ store: () => errAsync(new Error('refused')) })

    failing.actor.send({ type: 'user.settings.locale-select', locale: 'es' })
    await waitFor(failing.actor, (state) => state.matches({ viewing: { language: 'idle' } }))
    expect(failing.emitted).toContainEqual(NOT_STORED)

    const left = screen({ store: () => errAsync(new Error('refused')) })

    left.actor.send({ type: 'user.settings.locale-select', locale: 'es' })
    left.set({ account: undefined })
    await waitFor(left.actor, (state) => state.matches({ viewing: { language: 'idle' } }))
    expect(left.emitted).not.toContainEqual(NOT_STORED)
  })
})

describe('the password region', () => {
  const NEW = 'Secret-new1'
  const SAVE = {
    type: 'user.settings.password.save-button',
    currentPassword: 'Secret-old1',
    password: NEW,
    confirmation: NEW,
  } as const
  const at = (settings: ReturnType<typeof screen>) =>
    settings.actor.getSnapshot().matches({ viewing: { password: 'kept' } })
      ? 'kept'
      : JSON.stringify(settings.actor.getSnapshot().value)

  /** The form with the new password typed twice, ready to save. */
  function typedTwice(changePassword?: SettingsMachineDeps['changePassword']) {
    const settings = screen(changePassword ? { changePassword } : {})

    settings.actor.send({
      type: 'user.settings.password.new-password-input',
      password: NEW,
      confirmation: '',
    })
    settings.actor.send({
      type: 'user.settings.password.password-confirmation-input',
      password: NEW,
      confirmation: NEW,
    })

    return settings
  }

  it('holds the save while the new password breaks a rule or the two differ', () => {
    const settings = screen()

    expect(settings.actor.getSnapshot().can(SAVE)).toBe(false)

    settings.actor.send({
      type: 'user.settings.password.new-password-input',
      password: NEW,
      confirmation: 'Secret-x',
    })

    expect(settings.actor.getSnapshot().context.passwordError).toBe(SETTINGS_PASSWORDS_DIFFER)
    expect(settings.actor.getSnapshot().can(SAVE)).toBe(false)

    settings.actor.send({
      type: 'user.settings.password.password-confirmation-input',
      password: NEW,
      confirmation: NEW,
    })

    expect(at(settings)).toBe('kept')
    expect(settings.actor.getSnapshot().context.passwordError).toBeUndefined()
    expect(settings.actor.getSnapshot().can(SAVE)).toBe(true)
  })

  it('changes the password with the current one, empties the form and says so on the toast', async () => {
    const changePassword = vi.fn((_current: string, _password: string) => okAsync(undefined))
    const settings = typedTwice(changePassword)

    settings.actor.send(SAVE)

    await waitFor(settings.actor, (state) =>
      state.matches({ viewing: { password: 'password-weak' } }),
    )
    expect(changePassword).toHaveBeenCalledWith('Secret-old1', NEW)
    expect(settings.emitted).toEqual([
      { type: 'clear', anchor: 'user.settings.password.current-password-input' },
      { type: 'clear', anchor: 'user.settings.password.new-password-input' },
      { type: 'clear', anchor: 'user.settings.password.password-confirmation-input' },
      { type: 'show', anchor: 'app-shell.toast', codes: ['password-changed'] },
    ])
  })

  it('keeps the form as typed with the code of a refusal', async () => {
    const settings = typedTwice(() =>
      errAsync(dataError('data:INVALID_CREDENTIALS', 'the current password is wrong')),
    )

    settings.actor.send(SAVE)

    await waitFor(settings.actor, (state) => state.context.passwordError !== undefined)
    expect(at(settings)).toBe('kept')
    expect(settings.actor.getSnapshot().context.passwordError).toBe('data:INVALID_CREDENTIALS')
    expect(settings.emitted).toEqual([])
  })
})

describe('the email region', () => {
  const SEND = {
    type: 'user.settings.email.send-button',
    email: 'ann.new@example.test',
    password: 'Secret-ann1',
  } as const

  it('sends the mail to the new email, and the message names it', async () => {
    const changeEmail = vi.fn((_email: string, _password: string) => okAsync(undefined))
    const settings = screen({ changeEmail })

    settings.actor.send(SEND)

    expect(settings.actor.getSnapshot().can(SEND)).toBe(false)

    const sent = await waitFor(settings.actor, (state) =>
      state.matches({ viewing: { email: 'sent' } }),
    )

    expect(changeEmail).toHaveBeenCalledWith('ann.new@example.test', 'Secret-ann1')
    expect(sent.context).toMatchObject({
      emailError: undefined,
      emailMessage: 'check-your-mail',
      sentTo: 'ann.new@example.test',
    })
    expect(sent.can(SEND)).toBe(true)
  })

  it('says why it was not sent, taking the message away', async () => {
    let refuse = false
    const settings = screen({
      changeEmail: () =>
        refuse ? errAsync(dataError('data:EMAIL_INVALID', 'not an email')) : okAsync(undefined),
    })

    settings.actor.send(SEND)
    await waitFor(settings.actor, (state) => state.matches({ viewing: { email: 'sent' } }))

    refuse = true
    settings.actor.send(SEND)

    const refused = await waitFor(settings.actor, (state) =>
      state.matches({ viewing: { email: 'idle' } }),
    )

    expect(refused.context).toMatchObject({
      emailError: 'data:EMAIL_INVALID',
      emailMessage: undefined,
      sentTo: undefined,
    })
  })
})
