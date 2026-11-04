import type { ResultAsync } from 'neverthrow'

import type { Locale } from '@workspace/i18n'

import type { ClearParams, NavigateParams, ShowParams } from '../../../../platform/flow-effects'
import type { Theme } from '../../../../platform/theme'
import type { FrameWrites } from '../setting-writes'

/** What the frame's guards read at the moment they are asked. */
export interface ShellValues {
  /** The account signed in on this device; none for a guest. */
  readonly account: string | undefined
  /** The account's settings as this tab holds them; none before they arrive. */
  readonly stored: { readonly locale: string; readonly theme: string } | undefined
  /** What this tab knows of each stored setting and of its own writes on their way. */
  readonly writes: FrameWrites
  /** Whether a field holds unsaved input now. */
  readonly unsaved: boolean
}

/**
 * An update the frame heard since the page loaded: the code its message says, and the update
 * itself (the build the server serves, or the protocol it refused), which a reload by itself
 * happens once for.
 */
export interface PendingUpdate {
  readonly code: 'new-version' | 'protocol-outdated'
  readonly update: string
}

/** The updates this tab loaded the page again for by itself, kept for the tab's life. */
export interface SelfReloads {
  readonly done: (update: string) => boolean
  readonly mark: (update: string) => void
}

/** What the frame keeps beside its state: the update it heard since the page loaded. */
export interface ShellContext {
  readonly pending: PendingUpdate | undefined
}

export type ShellEvent =
  | { readonly type: 'platform.started' }
  | { readonly type: 'platform.opened' }
  | { readonly type: 'platform.open-failed' }
  | { readonly type: 'platform.storage-blocked' }
  | { readonly type: 'app-shell.locale-select'; readonly locale: Locale }
  | { readonly type: 'app-shell.theme-select'; readonly theme: Theme }
  | { readonly type: 'platform.theme-set' }
  | { readonly type: 'model.settings.locale' }
  | { readonly type: 'model.settings.theme' }
  | { readonly type: 'app-shell.sign-out-here-button' }
  | { readonly type: 'platform.signed-out' }
  | { readonly type: 'platform.change-rejected' }
  | { readonly type: 'platform.changes-reloaded' }
  | { readonly type: 'platform.crashed' }
  | { readonly type: 'platform.navigated' }
  | { readonly type: 'app-shell.reload-button' }
  | { readonly type: 'platform.new-version'; readonly served: string }
  | { readonly type: 'platform.protocol-refused' }
  | { readonly type: 'platform.tab-hidden' }
  | { readonly type: 'app-shell.update-button' }
  | { readonly type: 'platform.synced' }
  | { readonly type: 'platform.sending' }
  | { readonly type: 'platform.connecting' }
  | { readonly type: 'platform.offline' }
  | { readonly type: 'platform.sync-stopped' }
  | { readonly type: 'platform.install-offered' }
  | { readonly type: 'platform.install-by-steps' }
  | { readonly type: 'platform.installed' }
  | { readonly type: 'app-shell.install-button' }
  | { readonly type: 'app-shell.install-later-button' }

/** The flow's effects, and the language the app is to speak. */
export type ShellEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate' } & NavigateParams)
  | { readonly type: 'speak'; readonly locale: Locale }

export interface ShellMachineDeps {
  readonly values: () => ShellValues
  /** Signs the saved account out on this device, when its data did not open. */
  readonly signOutHere: () => ResultAsync<unknown, unknown>
  /** Loads the page again from the server. */
  readonly reload: () => void
  /** Shows a theme on this device and keeps it there. */
  readonly setTheme: (theme: Theme) => void
  /** Shows the theme another tab of this browser chose for this device. */
  readonly followTheme: () => void
  readonly selfReloads: SelfReloads
  /** Installing the app on this device: the browser's own window, or the reminder put off. */
  readonly install: { readonly prompt: () => Promise<void>; readonly postpone: () => void }
}
