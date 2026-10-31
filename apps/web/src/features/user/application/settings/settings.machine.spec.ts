import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { Locale } from '@workspace/i18n'

import type { Theme } from '../../../../platform/theme'

import { createSettingsMachine, type SettingsValues } from './settings.machine'

function screen(options: { readonly store?: () => ResultAsync<void, unknown> } = {}) {
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
