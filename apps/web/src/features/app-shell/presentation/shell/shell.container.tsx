import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useSelector } from '@xstate/react'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { useT } from '@workspace/i18n'
import { useUnsavedInput } from '@workspace/ui/unsaved-input'

import { EVENTS } from '../../../../platform/events.port'
import { useFrameEffects } from '../../../../platform/frame-effects'
import { type InstallOffer, useDeviceInstall } from '../../../../platform/install'
import { useLeaveGuard } from '../../../../platform/leave-guard.port'
import { useService, useShape } from '../../../../platform/module'
import { useNotice } from '../../../../platform/notices'
import { SERVED_BUILD } from '../../../../platform/served-build.port'
import { SESSION } from '../../../../platform/session.port'
import { SYNC_STATUS, type SyncStatus } from '../../../../platform/sync-status.port'
import { useDeviceTheme } from '../../../../platform/theme'
import { useDismissToast, useToasts } from '../../../../platform/toasts'
import { settingsShape } from '../../../user/application/settings/settings.model.gen'
import { LocaleWrites } from '../../application/locale-writes'
import { shellEvents } from '../../application/shell.events'

import { pageTitle } from './page-title'
import { type ShellLinkProps, ShellView } from './shell.view'
import { useShellFrame } from './shell-frame'

const RouterLink = ({ to, ...props }: ShellLinkProps) => <Link to={to} {...props} />

const CRASH_MESSAGE = 'app-shell.crash-message'
const UPDATE_MESSAGE = 'app-shell.update-message'
const SYNC_MESSAGE = 'app-shell.sync-message'

/** The frame's platform event for each state of the sync. */
const SYNC_EVENTS = {
  synced: 'platform.synced',
  sending: 'platform.sending',
  connecting: 'platform.connecting',
  offline: 'platform.offline',
  'sync-stopped': 'platform.sync-stopped',
} as const

const INSTALL_MESSAGE = 'app-shell.install-message'

/** The frame's platform event for each offer to install the app. */
const INSTALL_EVENTS = {
  'install-offered': 'platform.install-offered',
  'install-by-steps': 'platform.install-by-steps',
  installed: 'platform.installed',
} as const satisfies Record<InstallOffer, string>

type InstallCode = 'install-available' | 'install-by-steps'

const installCode = (codes: readonly string[]): InstallCode | undefined =>
  codes.includes('install-available')
    ? 'install-available'
    : codes.includes('install-by-steps')
      ? 'install-by-steps'
      : undefined

const syncCode = (codes: readonly string[]): SyncStatus | undefined =>
  codes.find((code): code is SyncStatus => Object.hasOwn(SYNC_EVENTS, code))

type UpdateCode = 'new-version' | 'protocol-outdated'

const updateCode = (codes: readonly string[]): UpdateCode | undefined =>
  codes.includes('protocol-outdated')
    ? 'protocol-outdated'
    : codes.includes('new-version')
      ? 'new-version'
      : undefined

export function ShellContainer(props: { readonly children?: ReactNode }) {
  const session = useService(SESSION)
  const events = useService(EVENTS)
  const servedBuild = useService(SERVED_BUILD)
  const syncStatus = useService(SYNC_STATUS)
  const install = useDeviceInstall()
  const offer = useSyncExternalStore(
    (onChange) => install.subscribe(onChange),
    () => install.current(),
  )
  const syncNow = useSyncExternalStore(
    (onChange) => syncStatus.subscribe(onChange),
    () => syncStatus.current(),
  )
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const { actor, live } = useShellFrame()
  const row = useShape(settingsShape, user ? { identity: user.id } : null).tree?.[0]
  const account = useRef<string | undefined>(undefined)
  const signedInAs = useRef<string | undefined>(undefined)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // The path of the route matched, as it is declared (`/$` for an unknown address).
  const route = useRouterState({
    select: (state): string | undefined => {
      const declared: unknown = state.matches.at(-1)?.fullPath

      return typeof declared === 'string' ? declared : undefined
    },
  })
  const notice = useNotice()
  const toasts = useToasts()
  const dismissToast = useDismissToast()
  const t = useT()
  const guard = useLeaveGuard()
  const router = useRouter()
  const [crash, setCrash] = useState<'screen-crashed' | undefined>(undefined)
  const [update, setUpdate] = useState<UpdateCode | undefined>(undefined)
  const [sync, setSync] = useState<SyncStatus | undefined>(undefined)
  const [installShown, setInstallShown] = useState<InstallCode | undefined>(undefined)
  const device = useDeviceTheme()
  const unsaved = useUnsavedInput()

  // What the frame's machine reads, current before it is asked anything below: the account signed
  // in and the language its settings hold here; another account, or none, starts knowing nothing
  // of its stored language.
  if (account.current !== user?.id) {
    account.current = user?.id
    live.generation += 1
    live.writes = LocaleWrites.none
  }

  live.account = user?.id
  live.stored = row?.locale
  live.unsaved = unsaved

  // Rendered again on every step of the machine; the select is enabled while its state takes a choice.
  useSelector(actor, (state) => state)
  // A signed-in account's data still opening: the frame shows no message of the platform yet, so
  // what the platform says reaches the frame's flow once the data is open.
  const dataOpening = actor.getSnapshot().matches('opening-data')
  const canChoose = actor.getSnapshot().can({ type: 'app-shell.locale-select', locale: 'en' })
  const canReload = actor.getSnapshot().can({ type: 'app-shell.reload-button' })
  const canChooseTheme = actor.getSnapshot().can({ type: 'app-shell.theme-select', theme: 'light' })
  const canUpdate = actor.getSnapshot().can({ type: 'app-shell.update-button' })
  const canInstall = actor.getSnapshot().can({ type: 'app-shell.install-button' })
  const canPostponeInstall = actor.getSnapshot().can({ type: 'app-shell.install-later-button' })

  // The stored language arriving or changing, here or from another device: the frame's data event.
  const stored = row?.locale

  useEffect(() => {
    if (stored === undefined) {
      return
    }

    actor.send({ type: 'model.settings.locale' })
    live.writes = live.writes.arrived(stored)
  }, [user?.id, stored, actor, live])

  // The account going away, by its own sign-out or from another device: the frame's platform event.
  useEffect(() => {
    const before = signedInAs.current

    signedInAs.current = user?.id

    if (before !== undefined && user?.id === undefined) {
      actor.send({ type: 'platform.signed-out' })
    }
  }, [user?.id, actor])

  // The frame's flow says its notice and clears it, as every screen's flow does.
  useFrameEffects(actor)

  // The bus's refusals reach the frame's flow, which says them on the notice or offers a reload;
  // a protocol refused before the frame listened (the sync of a saved account starts with the
  // page) reaches it now.
  useEffect(() => {
    if (dataOpening) {
      return
    }

    const stop = shellEvents(events, actor)

    if (session.protocolRefused()) {
      actor.send({ type: 'platform.protocol-refused' })
    }

    return stop
  }, [dataOpening, events, session, actor])

  // A newer build the server serves: the frame's platform event.
  useEffect(
    () =>
      dataOpening
        ? undefined
        : servedBuild.watch((served) => actor.send({ type: 'platform.new-version', served })),
    [dataOpening, servedBuild, actor],
  )

  // The state of this device's sync, while an account is signed in: the frame's platform event.
  useEffect(() => {
    if (!dataOpening && syncNow !== undefined) {
      actor.send({ type: SYNC_EVENTS[syncNow] })
    }
  }, [dataOpening, syncNow, actor])

  // The browser's offer to install the app, or the app installed: the frame's platform event.
  useEffect(() => {
    if (!dataOpening && offer !== undefined) {
      actor.send({ type: INSTALL_EVENTS[offer] })
    }
  }, [dataOpening, offer, actor])

  // The tab going to the background: the frame's platform event, which loads the page again by
  // itself when an update waits and no field holds unsaved input.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        actor.send({ type: 'platform.tab-hidden' })
      }
    }

    document.addEventListener('visibilitychange', hidden)

    return () => document.removeEventListener('visibilitychange', hidden)
  }, [actor])

  // The crash message shows what the frame's flow shows on it, and goes when the flow clears it.
  // A layout effect: every one runs before any passive effect, so this listens before the crash
  // put in a page's place (a descendant, whose passive effect runs first) raises it on arrival.
  useLayoutEffect(() => {
    const shown = actor.on('show', (event) => {
      if (event.anchor === CRASH_MESSAGE && event.codes.includes('screen-crashed')) {
        setCrash('screen-crashed')
      }
    })
    const cleared = actor.on('clear', (event) => {
      if (event.anchor === CRASH_MESSAGE) {
        setCrash(undefined)
      }

      if (event.anchor === SYNC_MESSAGE) {
        setSync(undefined)
      }

      if (event.anchor === INSTALL_MESSAGE) {
        setInstallShown(undefined)
      }
    })
    const installing = actor.on('show', (event) => {
      if (event.anchor === INSTALL_MESSAGE) {
        setInstallShown(installCode(event.codes))
      }
    })
    const synced = actor.on('show', (event) => {
      if (event.anchor === SYNC_MESSAGE) {
        setSync(syncCode(event.codes))
      }
    })
    // The update message stays until the page loads again: the flow never clears it.
    const updated = actor.on('show', (event) => {
      if (event.anchor === UPDATE_MESSAGE) {
        setUpdate(updateCode(event.codes))
      }
    })

    return () => {
      shown.unsubscribe()
      cleared.unsubscribe()
      updated.unsubscribe()
      synced.unsubscribe()
      installing.unsubscribe()
    }
  }, [actor])

  // The browser tab names the open screen in the language the app speaks.
  useEffect(() => {
    document.title = pageTitle(route, t)
  }, [route, t])

  // Another screen opening, by a link, Back, Forward or an address typed: the frame's platform event.
  useEffect(
    () => router.subscribe('onBeforeNavigate', () => actor.send({ type: 'platform.navigated' })),
    [router, actor],
  )

  return (
    <ShellView
      status={dataOpening ? 'opening-data' : 'ready'}
      signedIn={user !== undefined}
      activePath={pathname}
      canChooseLocale={canChoose}
      onLocaleChange={(locale) => {
        // A change of language is a leave the frame asks about while a field holds unsaved input.
        void guard.before('app-shell.locale-select').then((leave) => {
          if (!leave) {
            return
          }

          const crashed = actor.getSnapshot().matches('crashed')

          actor.send({ type: 'app-shell.locale-select', locale })

          // A language chosen around a crash renders the screen that failed again.
          if (crashed && !actor.getSnapshot().matches('crashed')) {
            live.renderAgain?.()
          }
        })
      }}
      theme={device.theme}
      canChooseTheme={canChooseTheme}
      onThemeChange={(theme) => actor.send({ type: 'app-shell.theme-select', theme })}
      crash={crash}
      canReload={canReload}
      onReload={() => {
        // A reload is a leave the frame asks about while a field holds unsaved input.
        void guard.before('app-shell.reload-button').then((leave) => {
          if (leave) {
            actor.send({ type: 'app-shell.reload-button' })
          }
        })
      }}
      sync={sync}
      install={installShown}
      canInstall={canInstall}
      onInstall={() => actor.send({ type: 'app-shell.install-button' })}
      canPostponeInstall={canPostponeInstall}
      onPostponeInstall={() => actor.send({ type: 'app-shell.install-later-button' })}
      update={update}
      canUpdate={canUpdate}
      onUpdate={() => {
        // A reload is a leave the frame asks about while a field holds unsaved input.
        void guard.before('app-shell.update-button').then((leave) => {
          if (leave) {
            actor.send({ type: 'app-shell.update-button' })
          }
        })
      }}
      link={RouterLink}
      notice={notice && { code: notice.code, text: notice.text(t) }}
      toasts={toasts.map(({ id, code, tone, text }) => ({ id, code, tone, text: text(t) }))}
      onDismissToast={dismissToast}
    >
      {props.children}
    </ShellView>
  )
}
