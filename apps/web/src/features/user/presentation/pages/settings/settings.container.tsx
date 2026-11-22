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
import { PASSKEYS_SERVICE } from '../../../application/passkeys.service'
import { settingsShape } from '../../../application/settings/settings.model.gen'
import { SETTINGS_SERVICE } from '../../../application/settings/settings.service'
import {
  createSettingsMachine,
  PASSKEYS_LIST,
  type SettingsValues,
  TWO_FACTOR_SECTION,
} from '../../../application/settings/settings-machine'
import { TWO_FACTOR_SERVICE } from '../../../application/two-factor.service'

import { DeletionFormView } from './deletion-form.view'
import { type EmailFormValues, EmailFormView } from './email-form.view'
import { PasskeysListView } from './passkeys-list.view'
import { type PasswordFormValues, PasswordFormView } from './password-form.view'
import { useSectionRead } from './section-read'
import { SettingsView } from './settings.view'
import { TwoFactorSectionView } from './two-factor-section.view'

const EMPTY_PASSWORDS: PasswordFormValues = { current: '', password: '', confirmation: '' }
const EMPTY_EMAIL: EmailFormValues = { email: '', password: '' }

/**
 * The settings screen: its flow run as its machine over the account's settings, the theme this
 * device shows and the account's password, email, second factor, passkeys and deletion, whose
 * forms' values the page holds so that the flow's `clear` empties them. The page reads the second
 * factor and the passkeys as it opens and again each time the flow reads them.
 */
export function SettingsContainer() {
  const session = useService(SESSION)
  const settings = useService(SETTINGS_SERVICE)
  const twoFactor = useService(TWO_FACTOR_SERVICE)
  const passkeys = useService(PASSKEYS_SERVICE)
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
  const [deletionPassword, setDeletionPassword] = useState('')
  const [factorPassword, setFactorPassword] = useState('')
  const [factorCode, setFactorCode] = useState('')
  const factor = useSectionRead(() => twoFactor.read())
  const listed = useSectionRead(() => passkeys.list())
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
      requestAccountDeletion: (password) => session.requestAccountDeletion(password),
      enableTwoFactor: (password) => twoFactor.enable(password),
      confirmTwoFactor: (code, enrolment) => twoFactor.confirm(code, enrolment),
      disableTwoFactor: (password) => twoFactor.disable(password),
      renewCodes: (password) => twoFactor.renewCodes(password),
      addPasskey: () => passkeys.add(),
      removePasskey: (passkey) => passkeys.remove(passkey),
    })
  }, [device.set, settings, writes, session, twoFactor, passkeys])
  const { state, send, submit, actor, can, renders } = useScreenMachine('user.settings', machine)

  // A chosen language is spoken at once, while its store runs.
  useEffect(() => {
    const spoken = actor.on('speak', (event) => setLocale(event.locale))

    return () => spoken.unsubscribe()
  }, [actor, setLocale])

  // The flow reads the second factor and the passkeys again after the actions that change them.
  useEffect(() => {
    const read = actor.on('read', (event) => {
      if (event.anchor === TWO_FACTOR_SECTION) {
        factor.again()
      } else if (event.anchor === PASSKEYS_LIST) {
        listed.again()
      }
    })

    return () => read.unsubscribe()
  }, [actor, factor.again, listed.again])

  // A changed password empties its form, and a deletion link sent its password, as the flow says.
  useFieldClears(actor, {
    'user.settings.password.current-password-input': () =>
      setPasswords((now) => ({ ...now, current: '' })),
    'user.settings.password.new-password-input': () =>
      setPasswords((now) => ({ ...now, password: '' })),
    'user.settings.password.password-confirmation-input': () =>
      setPasswords((now) => ({ ...now, confirmation: '' })),
    'user.settings.deletion.password-input': () => setDeletionPassword(''),
    'user.settings.two-factor.password-input': () => setFactorPassword(''),
    'user.settings.two-factor.code-input': () => setFactorCode(''),
  })

  return (
    <div className="flex flex-col gap-4">
      <SettingsView
        theme={device.theme}
        locale={locale}
        can={can}
        onTheme={(theme) => send({ type: 'user.settings.theme-select', theme })}
        onLocale={(chosen) => send({ type: 'user.settings.locale-select', locale: chosen })}
      />
      <PasswordFormView
        values={passwords}
        error={state.context.passwordError}
        can={can}
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
        can={can}
        onChange={setEmail}
        onSend={() =>
          submit({
            type: 'user.settings.email.send-button',
            email: email.email,
            password: email.password,
          })
        }
      />
      <TwoFactorSectionView
        factor={
          factor.read.status === 'ready'
            ? { status: 'ready', enabled: factor.read.value }
            : { status: factor.read.status }
        }
        renders={renders}
        can={can}
        password={factorPassword}
        code={factorCode}
        error={state.context.twoFactorError}
        start={state.context.start}
        backupCodes={state.context.backupCodes}
        onPassword={setFactorPassword}
        onCode={setFactorCode}
        onEnable={() =>
          submit({ type: 'user.settings.two-factor.enable-button', password: factorPassword })
        }
        onDisable={() =>
          send({ type: 'user.settings.two-factor.disable-button', password: factorPassword })
        }
        onRenew={() =>
          send({ type: 'user.settings.two-factor.renew-codes-button', password: factorPassword })
        }
        onConfirm={() =>
          submit({ type: 'user.settings.two-factor.confirm-button', code: factorCode })
        }
        onStop={() => send({ type: 'user.settings.two-factor.stop-button' })}
        onHideCodes={() => send({ type: 'user.settings.two-factor.hide-codes-button' })}
      />
      <PasskeysListView
        passkeys={
          listed.read.status === 'ready'
            ? { status: 'ready', items: listed.read.value }
            : { status: listed.read.status }
        }
        error={state.context.passkeysError}
        can={can}
        onAdd={() => send({ type: 'user.settings.passkeys.add-button' })}
        onRemove={(passkey) => send({ type: 'user.settings.passkeys.remove-button', passkey })}
      />
      <DeletionFormView
        password={deletionPassword}
        error={state.context.deletionError}
        message={state.context.deletionMessage}
        can={can}
        onChange={setDeletionPassword}
        onSend={() =>
          submit({ type: 'user.settings.deletion.send-button', password: deletionPassword })
        }
      />
    </div>
  )
}

/** Taken under the guard settingsHeld, so the settings are on the device when a store starts. */
function never(): never {
  throw new Error('the settings are not on this device')
}
