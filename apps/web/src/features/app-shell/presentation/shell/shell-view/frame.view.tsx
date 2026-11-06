import type { ComponentType, ReactNode } from 'react'

import { type Locale, useT } from '@workspace/i18n'
import { AppShell } from '@workspace/ui/components/platform/app-shell'

import type { SyncStatus } from '../../../../../platform/sync-status.port'
import type { Theme } from '../../../../../platform/theme'

import { HeaderActions } from './header-actions.view'
import { InstallAlert, type InstallCode } from './install-alert.view'
import { NavigationLinks, type ShellLinkProps } from './navigation-links.view'
import { NoticeLine, type ShellNotice } from './notice-line.view'
import { type CrashCode, ScreenCrash } from './screen-crash.view'
import { SignOutHere } from './sign-out-here.view'
import { type ShellStatus, StatusLine } from './status-line.view'
import { type ShellToast, Toasts } from './toasts.view'
import { UpdateAlert, type UpdateCode } from './update-alert.view'

/** The anchors only some states of the frame's flow render that the frame shows or leaves out. */
export type ShellListed =
  | 'app-shell.nav'
  | 'app-shell.reload-button'
  | 'app-shell.sign-out-here-button'

export interface ShellViewProps {
  /** Where the start is: the status line says it, and the screen waits for it. */
  readonly status: ShellStatus
  /**
   * Whether the frame's flow, in its state, renders an anchor: the navigation of a signed-in
   * account, the reload around a crash, the sign-out here when the account's data did not open.
   */
  readonly renders: (anchor: ShellListed) => boolean
  readonly signedIn: boolean
  readonly activePath: string
  /** Whether the frame's flow takes a language choice now: the select is enabled while it does. */
  readonly canChooseLocale: boolean
  readonly onLocaleChange: (locale: Locale) => void
  /** The theme this device shows. */
  readonly theme: Theme
  /** Whether the frame's flow takes a theme choice now: the select is enabled while it does. */
  readonly canChooseTheme: boolean
  readonly onThemeChange: (theme: Theme) => void
  readonly link?: ComponentType<ShellLinkProps>
  /** Signs the saved account out on this device when its data could not be opened; none without one. */
  readonly onSignOutHere?: (() => void) | undefined
  /** That sign-out runs: the button waits for it. */
  readonly signingOutHere?: boolean | undefined
  /** The latest message for the user: its contract code and its text, already translated. */
  readonly notice?: ShellNotice | undefined
  /** The toasts shown, the newest first, each with its tone and its words in the language the app speaks. */
  readonly toasts?: readonly ShellToast[] | undefined
  readonly onDismissToast?: ((id: number) => void) | undefined
  /** The code the crash message shows while the open screen failed to render; none otherwise. */
  readonly crash?: CrashCode | undefined
  /** Whether the frame's flow takes a reload now: the button is enabled while it does. */
  readonly canReload?: boolean | undefined
  readonly onReload?: (() => void) | undefined
  /** The code the update message shows once the page should load again; none before. */
  readonly update?: UpdateCode | undefined
  /** Whether the frame's flow takes the update's reload now: the button is enabled while it does. */
  readonly canUpdate?: boolean | undefined
  readonly onUpdate?: (() => void) | undefined
  /** The code the state of the sync shows for a signed-in account; none for a guest. */
  readonly sync?: SyncStatus | undefined
  /** The code the reminder to install the app shows until it is installed or put off; none else. */
  readonly install?: InstallCode | undefined
  /** Whether the frame's flow takes the install now: its button is enabled while it does. */
  readonly canInstall?: boolean | undefined
  readonly onInstall?: (() => void) | undefined
  /** Whether the frame's flow takes the reminder put off now. */
  readonly canPostponeInstall?: boolean | undefined
  readonly onPostponeInstall?: (() => void) | undefined
  readonly children?: ReactNode
}

/**
 * The page frame around the open screen: it lays out its parts in the kit's `AppShell`, each part
 * shown in the states of the start and of the frame's flow that show it.
 */
export function ShellView(props: ShellViewProps) {
  const t = useT()
  // No message of the platform shows before a signed-in account's data is open.
  const ready = props.status === 'ready'
  // A signed-in account's navigation; a guest sees none, and the page takes the frame's width.
  const navigation =
    props.signedIn && props.renders('app-shell.nav') ? (
      <NavigationLinks link={props.link} activePath={props.activePath} />
    ) : undefined
  const reload = props.renders('app-shell.reload-button')

  return (
    <AppShell
      brand={t('app.shell.title')}
      navigationLabel={t('app.shell.navigation')}
      navigationTestId="app-shell.nav"
      actions={
        <HeaderActions
          signedIn={props.signedIn}
          sync={ready ? props.sync : undefined}
          theme={props.theme}
          canChooseTheme={props.canChooseTheme}
          onThemeChange={props.onThemeChange}
          canChooseLocale={props.canChooseLocale}
          onLocaleChange={props.onLocaleChange}
        />
      }
      navigation={navigation}
      status={<StatusLine status={props.status} />}
    >
      {ready && props.update ? (
        <UpdateAlert update={props.update} canUpdate={props.canUpdate} onUpdate={props.onUpdate} />
      ) : null}
      {ready && props.install ? (
        <InstallAlert
          install={props.install}
          canInstall={props.canInstall}
          onInstall={props.onInstall}
          canPostponeInstall={props.canPostponeInstall}
          onPostponeInstall={props.onPostponeInstall}
        />
      ) : null}
      {/* The notice shows once a signed-in account's data is open, and a notice raised before
          waits for it; a toast answers what the user just did, so it shows at once. */}
      <NoticeLine notice={ready ? props.notice : undefined} />
      <Toasts toasts={props.toasts} onDismissToast={props.onDismissToast} />
      {props.renders('app-shell.sign-out-here-button') && props.onSignOutHere ? (
        <SignOutHere onSignOutHere={props.onSignOutHere} signingOutHere={props.signingOutHere} />
      ) : null}
      {props.crash || reload ? (
        <ScreenCrash
          crash={props.crash}
          reload={reload}
          canReload={props.canReload}
          onReload={props.onReload}
        />
      ) : null}
      {/* The screen renders once ready, and around a signed-in account's data while it opens. */}
      {ready || props.status === 'opening-data' ? props.children : null}
    </AppShell>
  )
}
