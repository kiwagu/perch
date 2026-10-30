import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { useLocale } from '@workspace/i18n'

import { useSetLocale } from '../../../../../platform/i18n'
import { useService, useShape } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { useDeviceTheme } from '../../../../../platform/theme'
import {
  createSettingsMachine,
  type SettingsValues,
} from '../../../application/settings/settings.machine'
import { settingsShape } from '../../../application/settings/settings.model.gen'
import { SETTINGS_SERVICE } from '../../../application/settings/settings.service'

import { SettingsView } from './settings.view'

/** The settings screen: its flow run as its machine over the device's theme and the account's settings. */
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
  // What the machine's guards read, current before it is asked: kept beside it, never in its context.
  const live = useRef<SettingsValues & { readonly store: typeof row }>({
    held: false,
    account: undefined,
    storingFor: undefined,
    store: undefined,
  })

  live.current = { ...live.current, held: row !== undefined, account: user?.id, store: row }

  const machine = useMemo(
    () =>
      createSettingsMachine({
        values: () => live.current,
        setTheme: device.set,
        storeLocale: (chosen) => {
          const stored = live.current.store

          live.current = { ...live.current, storingFor: live.current.account }

          return settings.updateLocale({ id: stored?.id ?? never(), locale: chosen })
        },
      }),
    [device.set, settings],
  )
  const { state, send, actor } = useScreenMachine(machine)

  // A chosen language is spoken at once, while its store runs.
  useEffect(() => {
    const spoken = actor.on('speak', (event) => setLocale(event.locale))

    return () => spoken.unsubscribe()
  }, [actor, setLocale])

  return (
    <SettingsView
      theme={device.theme}
      locale={locale}
      canChooseTheme={state.can({ type: 'user.settings.theme-select', theme: 'light' })}
      canChooseLocale={state.can({ type: 'user.settings.locale-select', locale: 'en' })}
      onTheme={(theme) => send({ type: 'user.settings.theme-select', theme })}
      onLocale={(chosen) => send({ type: 'user.settings.locale-select', locale: chosen })}
    />
  )
}

/** Taken under the guard settingsHeld, so the settings are on the device when a store starts. */
function never(): never {
  throw new Error('the settings are not on this device')
}
