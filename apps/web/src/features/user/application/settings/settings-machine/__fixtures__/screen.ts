import { okAsync, type ResultAsync } from 'neverthrow'
import { vi } from 'vitest'
import { createActor } from 'xstate'

import type { Locale } from '@workspace/i18n'
import { two_factorIdFactory } from '@workspace/ids'

import { rendersIn } from '../../../../../../platform/screen-renders'
import type { Theme } from '../../../../../../platform/theme'
import type { TwoFactorStart } from '../../../two-factor.service'

import { createSettingsMachine, type SettingsMachineDeps, type SettingsValues } from '..'

/** What a start of the second factor answers: its key, the QR of it, ten codes and the enrolment. */
export const STARTED: TwoFactorStart = {
  key: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Perch:ann%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Perch',
  qr: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  backupCodes: Array.from({ length: 10 }, (_, index) => `backup-0000${index}`),
  enrolment: two_factorIdFactory.create(),
}

/** What a renewal answers: ten other codes. */
export const RENEWED: readonly string[] = Array.from(
  { length: 10 },
  (_, index) => `renewed-0000${index}`,
)

export interface ScreenOptions {
  readonly store?: () => ResultAsync<void, unknown>
  readonly storeTheme?: () => ResultAsync<void, unknown>
  readonly changePassword?: SettingsMachineDeps['changePassword']
  readonly changeEmail?: SettingsMachineDeps['changeEmail']
  readonly requestAccountDeletion?: SettingsMachineDeps['requestAccountDeletion']
  readonly enableTwoFactor?: SettingsMachineDeps['enableTwoFactor']
  readonly confirmTwoFactor?: SettingsMachineDeps['confirmTwoFactor']
  readonly disableTwoFactor?: SettingsMachineDeps['disableTwoFactor']
  readonly renewCodes?: SettingsMachineDeps['renewCodes']
  readonly addPasskey?: SettingsMachineDeps['addPasskey']
  readonly removePasskey?: SettingsMachineDeps['removePasskey']
}

/** The machine's dependencies: doubles that succeed unless an option says otherwise. */
function depsOf(options: ScreenOptions, values: () => SettingsValues, tell: Doubles) {
  return {
    values,
    setTheme: tell.setTheme,
    storeTheme: tell.storeTheme,
    storeLocale: tell.storeLocale,
    changePassword: options.changePassword ?? (() => okAsync(undefined)),
    changeEmail: options.changeEmail ?? (() => okAsync(undefined)),
    requestAccountDeletion: options.requestAccountDeletion ?? (() => okAsync(undefined)),
    enableTwoFactor: options.enableTwoFactor ?? (() => okAsync(STARTED)),
    confirmTwoFactor: options.confirmTwoFactor ?? (() => okAsync(undefined)),
    disableTwoFactor: options.disableTwoFactor ?? (() => okAsync(undefined)),
    renewCodes: options.renewCodes ?? (() => okAsync(RENEWED)),
    addPasskey: options.addPasskey ?? (() => okAsync(undefined)),
    removePasskey: options.removePasskey ?? (() => okAsync(undefined)),
  } satisfies SettingsMachineDeps
}

interface Doubles {
  readonly setTheme: (theme: Theme) => void
  readonly storeTheme: (theme: Theme) => ResultAsync<void, unknown>
  readonly storeLocale: (locale: Locale) => ResultAsync<void, unknown>
}

/**
 * The settings machine over doubles that succeed unless an option says otherwise, started, with
 * what it emitted so far in `emitted` and the guards' values to change through `set`.
 */
export function screen(options: ScreenOptions = {}) {
  let values: SettingsValues = { held: true, account: 'idn_ann', storingFor: undefined }
  const setTheme = vi.fn<(theme: Theme) => void>()
  const storeTheme = vi.fn<(theme: Theme) => ResultAsync<void, unknown>>(
    options.storeTheme ?? (() => okAsync(undefined)),
  )
  const storeLocale = vi.fn<(locale: Locale) => ResultAsync<void, unknown>>(
    options.store ?? (() => okAsync(undefined)),
  )
  const actor = createActor(
    createSettingsMachine(
      depsOf(options, () => values, {
        setTheme,
        storeTheme: (theme) => {
          values = { ...values, storingFor: values.account }

          return storeTheme(theme)
        },
        storeLocale: (locale) => {
          values = { ...values, storingFor: values.account }

          return storeLocale(locale)
        },
      }),
    ),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    setTheme,
    storeTheme,
    storeLocale,
    emitted,
    set: (more: Partial<SettingsValues>) => {
      values = { ...values, ...more }
    },
  }
}

/**
 * What the machine renders while the second factor region is in `state` (the other regions at
 * rest), as a view reads it: an anchor no state lists renders always.
 */
export function rendersAt(state: string): (anchor: string) => boolean {
  const { config } = createSettingsMachine(
    depsOf({}, () => ({ held: true, account: undefined, storingFor: undefined }), {
      setTheme: () => {},
      storeTheme: () => okAsync(undefined),
      storeLocale: () => okAsync(undefined),
    }),
  )

  return rendersIn(config, {
    viewing: {
      theme: 'idle',
      language: 'idle',
      password: 'password-weak',
      email: 'idle',
      'two-factor': state,
      'passkey-add': 'idle',
      'passkey-remove': 'idle',
      deletion: 'idle',
    },
  })
}
