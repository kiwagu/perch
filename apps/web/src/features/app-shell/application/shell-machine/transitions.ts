/**
 * The transitions and effects the frame's flow writes in several states, each as the machine's
 * config takes it.
 */

export const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const
/** The notice goes with the account that was signed in when it was raised, the state of its sync too. */
export const SIGNED_OUT = {
  actions: [
    { type: 'clear', params: { anchor: 'app-shell.notice-message' } },
    { type: 'clear', params: { anchor: 'app-shell.sync-message' } },
  ],
} as const
/** A sign-in on this device ends the words the sign-in page had not said yet. */
export const SIGNED_IN = {
  actions: { type: 'clear', params: { anchor: 'user.sign-in.notice-message' } },
} as const
/** The gateway refused a change this device then undid, or refused the undo too. */
export const REJECTED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['change-rejected'] },
} as const
export const RELOADED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['changes-reloaded'] },
} as const
/** The open screen failed to render: the frame says so in its place, until it goes. */
export const CRASHED = {
  type: 'show',
  params: { anchor: 'app-shell.crash-message', codes: ['screen-crashed'] },
} as const
export const CRASH_GONE = { type: 'clear', params: { anchor: 'app-shell.crash-message' } } as const
/** A theme chosen applies at once, whatever the frame is doing; one another guest tab chose too. */
export const THEME_CHOSEN = { actions: 'applyTheme' } as const
export const THEME_SET = { guard: 'signedOut', actions: 'followTheme' } as const
/** The settings store a language or a theme this tab has not seen yet: the app applies it. */
export const LOCALE_STORED = { guard: 'storedElsewhere', actions: 'speakStored' } as const
export const THEME_STORED = { guard: 'themeStoredElsewhere', actions: 'showStoredTheme' } as const
/**
 * The server serves a newer build, or no longer takes this build's protocol: the frame offers to
 * load the page again, and a refused protocol, which says more, keeps its message.
 */
export const NEW_VERSION = {
  guard: 'protocolTaken',
  actions: [
    'noteVersion',
    { type: 'show', params: { anchor: 'app-shell.update-message', codes: ['new-version'] } },
  ],
} as const
/** The state of this device's sync, as the platform says it. */
const syncShows = (code: 'synced' | 'sending' | 'connecting' | 'offline' | 'sync-stopped') =>
  ({
    actions: { type: 'show', params: { anchor: 'app-shell.sync-message', codes: [code] } },
  }) as const

export const SYNC = {
  'platform.synced': syncShows('synced'),
  'platform.sending': syncShows('sending'),
  'platform.connecting': syncShows('connecting'),
  'platform.offline': syncShows('offline'),
  'platform.sync-stopped': syncShows('sync-stopped'),
} as const
/** The reminder to install the app, until it is installed or put off. */
export const INSTALL_AVAILABLE = {
  actions: {
    type: 'show',
    params: { anchor: 'app-shell.install-message', codes: ['install-available'] },
  },
} as const
export const INSTALL_BY_STEPS = {
  actions: {
    type: 'show',
    params: { anchor: 'app-shell.install-message', codes: ['install-by-steps'] },
  },
} as const
export const INSTALL_GONE = {
  type: 'clear',
  params: { anchor: 'app-shell.install-message' },
} as const
export const PROTOCOL_OUTDATED = {
  actions: [
    'noteProtocol',
    { type: 'show', params: { anchor: 'app-shell.update-message', codes: ['protocol-outdated'] } },
  ],
} as const
