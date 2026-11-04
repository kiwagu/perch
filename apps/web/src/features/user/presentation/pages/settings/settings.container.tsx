import type { ResultAsync } from 'neverthrow'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { BusError } from '@workspace/cqrs'
import { useLocale } from '@workspace/i18n'
import type { SettingsId } from '@workspace/ids'

import { useFieldClears } from '../../../../../platform/field-clears'
import { useSetLocale } from '../../../../../platform/i18n'
import { useService, useShape } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { trackedStore, useSettingsWrites } from '../../../../../platform/settings-writes'
import { useDeviceTheme } from '../../../../../platform/theme'
import { settingsShape } from '../../../application/settings/settings.model.gen'
import { SETTINGS_SERVICE } from '../../../application/settings/settings.service'
import {
  createSettingsMachine,
  type SettingsValues,
} from '../../../application/settings/settings-machine'

import { type EmailFormValues, EmailFormView } from './email-form.view'
import { type PasswordFormValues, PasswordFormView } from './password-form.view'
import { SettingsView } from './settings.view'

const EMPTY_PASSWORDS: PasswordFormValues = { current: '', password: '', confirmation: '' }
const EMPTY_EMAIL: EmailFormValues = { email: '', password: '' }

/**
 * The settings screen: its flow run as its machine over the account's settings, the theme this
 * device shows and the account's password and email, whose forms' values the page holds so that
 * the flow's `clear` empties them.
 */
export function SettingsContainer() {
  const session = useService(SESSION)
  const settings = useService(SETTINGS_SERVICE)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const row = useShape(settingsShape, user ? { identity: user.id } : null).tree?.[0]
  const device = useDeviceTheme()
  const locale = useLocale()
  const setLocale = useSetLocale()
  const writes = useSettingsWrites()
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS)
  const [email, setEmail] = useState(EMPTY_EMAIL)
  // What the machine's guards read, current before it is asked: kept beside it, never in its context.
  const live = useRef<SettingsValues & { readonly store: typeof row }>({
    held: false,
    account: undefined,
    storingFor: undefined,
    store: undefined,
  })

  live.current = { ...live.current, held: row !== undefined, account: user?.id, store: row }

  const machine = useMemo(() => {
    /** A store into the settings on the device, noting the account it began for. */
    const intoSettings =
      <T,>(store: (id: SettingsId, value: T) => ResultAsync<void, BusError>) =>
      (value: T) => {
        const stored = live.current.store

        live.current = { ...live.current, storingFor: live.current.account }

        return store(stored?.id ?? never(), value)
      }

    return createSettingsMachine({
      values: () => live.current,
      setTheme: device.set,
      // The frame learns of each write, so its echo is not taken for another tab's or device's.
      storeTheme: trackedStore(
        writes.theme,
        intoSettings((id, theme) => settings.updateTheme({ id, theme })),
      ),
      storeLocale: trackedStore(
        writes.locale,
        intoSettings((id, locale) => settings.updateLocale({ id, locale })),
      ),
      changePassword: (currentPassword, password) =>
        session.changePassword(currentPassword, password),
      changeEmail: (address, password) => session.changeEmail(address, password),
    })
  }, [device.set, settings, writes, session])
  const { state, send, submit, actor } = useScreenMachine(machine)

  // A chosen language is spoken at once, while its store runs.
  useEffect(() => {
    const spoken = actor.on('speak', (event) => setLocale(event.locale))

    return () => spoken.unsubscribe()
  }, [actor, setLocale])

  // A changed password empties its form, as the flow says.
  useFieldClears(actor, {
    'user.settings.password.current-password-input': () =>
      setPasswords((now) => ({ ...now, current: '' })),
    'user.settings.password.new-password-input': () =>
      setPasswords((now) => ({ ...now, password: '' })),
    'user.settings.password.password-confirmation-input': () =>
      setPasswords((now) => ({ ...now, confirmation: '' })),
  })

  return (
    <div className="flex flex-col gap-4">
      <SettingsView
        theme={device.theme}
        locale={locale}
        canChooseTheme={state.can({ type: 'user.settings.theme-select', theme: 'light' })}
        canChooseLocale={state.can({ type: 'user.settings.locale-select', locale: 'en' })}
        onTheme={(theme) => send({ type: 'user.settings.theme-select', theme })}
        onLocale={(chosen) => send({ type: 'user.settings.locale-select', locale: chosen })}
      />
      <PasswordFormView
        values={passwords}
        error={state.context.passwordError}
        canSave={state.can({
          type: 'user.settings.password.save-button',
          currentPassword: '',
          password: '',
          confirmation: '',
        })}
        onChange={(field, next) => {
          setPasswords(next)

          const typed = { password: next.password, confirmation: next.confirmation }

          if (field === 'password') {
            send({ type: 'user.settings.password.new-password-input', ...typed })
          } else if (field === 'confirmation') {
            send({ type: 'user.settings.password.password-confirmation-input', ...typed })
          }
        }}
        // A save that finds the two differing asks for nothing, so what was typed stays unsaved.
        onSave={() =>
          submit({
            type: 'user.settings.password.save-button',
            currentPassword: passwords.current,
            password: passwords.password,
            confirmation: passwords.confirmation,
          }).then(
            (saved) =>
              saved && !actor.getSnapshot().matches({ viewing: { password: 'passwords-differ' } }),
          )
        }
      />
      <EmailFormView
        values={email}
        error={state.context.emailError}
        message={state.context.emailMessage}
        sentTo={state.context.sentTo}
        canSend={state.can({ type: 'user.settings.email.send-button', email: '', password: '' })}
        onChange={setEmail}
        onSend={() =>
          submit({
            type: 'user.settings.email.send-button',
            email: email.email,
            password: email.password,
          })
        }
      />
    </div>
  )
}

/** Taken under the guard settingsHeld, so the settings are on the device when a store starts. */
function never(): never {
  throw new Error('the settings are not on this device')
}
