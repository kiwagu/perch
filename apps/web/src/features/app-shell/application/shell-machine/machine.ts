import {
  and,
  assertEvent,
  assign,
  emit,
  enqueueActions,
  fromPromise,
  not,
  setup,
  stateIn,
} from 'xstate'

import type { Locale } from '@workspace/i18n'

import { settled } from '../../../../platform/actor-outcome'
import type { ClearParams, NavigateParams, ShowParams } from '../../../../platform/flow-effects'
import type { Theme } from '../../../../platform/theme'

import type { ShellContext, ShellEmitted, ShellEvent, ShellMachineDeps } from './events'
import { FRAME_STATES } from './frame-states'
import {
  CRASH_GONE,
  CRASHED,
  FRAME_MESSAGES,
  INSTALL_GONE,
  SIGNED_IN,
  SIGNED_OUT,
  THEME_CHOSEN,
  TO_SIGN_IN,
} from './transitions'

/** The frame's flow (`contract/domain/screens/__root.yaml`) as the app runs it. */
export function createShellMachine(deps: ShellMachineDeps) {
  /** The stored language, when another tab or device stored it and this tab has not seen it yet. */
  const storedElsewhere = (): Locale | undefined => {
    const { stored, writes } = deps.values()

    return stored === undefined ? undefined : writes.locale.elsewhere(stored.locale)
  }
  /** The stored theme, when another tab or device stored it and this tab has not seen it yet. */
  const themeStoredElsewhere = (): Theme | undefined => {
    const { stored, writes } = deps.values()

    return stored === undefined ? undefined : writes.theme.elsewhere(stored.theme)
  }

  return setup({
    types: {
      context: {} as ShellContext,
      events: {} as ShellEvent,
      emitted: {} as ShellEmitted,
    },
    actors: {
      'platform.sign-out': fromPromise<unknown>(() => settled(deps.signOutHere())),
      // The page unloads as it loads again; the outcome is seen only if it did not.
      'platform.reload': fromPromise<void>(async () => deps.reload()),
      'platform.install.prompt': fromPromise<void>(() => deps.install.prompt()),
      'platform.install.postpone': fromPromise<void>(async () => deps.install.postpone()),
    },
    guards: {
      signedOut: () => deps.values().account === undefined,
      storedElsewhere: () => storedElsewhere() !== undefined,
      themeStoredElsewhere: () => themeStoredElsewhere() !== undefined,
      protocolTaken: ({ context }) => context.pending?.code !== 'protocol-outdated',
      // The frame shows the open screen as usual: its `screen` region is in `ready`.
      screenReady: stateIn(FRAME_STATES.ready),
      // An update waits, and no install window is open: a reload nobody asked for would lose
      // the browser's answer.
      quietReload: and([
        ({ context }) =>
          context.pending !== undefined &&
          !deps.values().unsaved &&
          !deps.selfReloads.done(context.pending.update),
        not(stateIn(FRAME_STATES.installing)),
      ]),
    },
    actions: {
      show: emit((_, params: ShowParams) => ({ type: 'show' as const, ...params })),
      clear: emit((_, params: ClearParams) => ({ type: 'clear' as const, ...params })),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
      speakChoice: emit(({ event }) => {
        assertEvent(event, 'app-shell.locale-select')

        return { type: 'speak' as const, locale: event.locale }
      }),
      applyTheme: ({ event }) => {
        assertEvent(event, 'app-shell.theme-select')
        deps.setTheme(event.theme)
      },
      followTheme: ({ event }) => {
        assertEvent(event, 'platform.theme-set')
        deps.followTheme()
      },
      noteVersion: assign({
        pending: ({ event }) => {
          assertEvent(event, 'platform.new-version')

          return { code: 'new-version', update: event.served } as const
        },
      }),
      noteProtocol: assign({
        pending: () => ({ code: 'protocol-outdated', update: 'protocol' }) as const,
      }),
      // Taken under the guard quietReload, so an update waits.
      markSelfReload: ({ context }) => {
        if (context.pending !== undefined) {
          deps.selfReloads.mark(context.pending.update)
        }
      },
      // Taken under the guard storedElsewhere, so the language is there to speak.
      speakStored: enqueueActions(({ enqueue }) => {
        const locale = storedElsewhere()

        if (locale !== undefined) {
          enqueue.emit({ type: 'speak', locale })
        }
      }),
      // Taken under the guard themeStoredElsewhere; the device keeps it as the theme it showed last.
      showStoredTheme: ({ event }) => {
        assertEvent(event, 'model.settings.theme')
        const theme = themeStoredElsewhere()

        if (theme !== undefined) {
          deps.setTheme(theme)
        }
      },
    },
  }).createMachine({
    context: { pending: undefined },
    initial: 'opening',
    states: {
      opening: {
        on: {
          'platform.started': [
            { target: 'running', guard: 'signedOut' },
            { target: 'opening-data' },
          ],
          'platform.start-failed': { target: 'start-failed' },
          'platform.storage-blocked': { target: 'storage-blocked' },
          'app-shell.locale-select': { target: 'opening', actions: 'speakChoice' },
          'app-shell.theme-select': THEME_CHOSEN,
        },
      },
      'opening-data': {
        meta: { renders: ['app-shell.nav'] },
        on: {
          'platform.opened': { target: 'running' },
          'platform.open-failed': { target: 'failed' },
          'platform.signed-in': SIGNED_IN,
          // Nothing is left to open: a guest's frame, the account's notice gone with it.
          'platform.signed-out': { target: 'running', ...SIGNED_OUT },
        },
      },
      // The frame around the open screen: its messages follow the platform whatever the screen
      // and the reminder to install are doing, so each is written once, here.
      running: {
        type: 'parallel',
        meta: { renders: ['app-shell.nav'] },
        on: FRAME_MESSAGES,
        states: {
          screen: {
            initial: 'ready',
            states: {
              ready: {
                on: {
                  'app-shell.locale-select': [
                    { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
                  ],
                  'platform.crashed': { target: 'crashed' },
                  'app-shell.update-button': { target: 'updating' },
                  'platform.tab-hidden': {
                    target: 'updating',
                    guard: 'quietReload',
                    actions: 'markSelfReload',
                  },
                },
              },
              crashed: {
                meta: { renders: ['app-shell.reload-button'] },
                entry: CRASHED,
                exit: CRASH_GONE,
                on: {
                  'app-shell.reload-button': { target: 'reloading' },
                  'platform.navigated': { target: 'ready' },
                  'app-shell.locale-select': [
                    { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
                  ],
                  'app-shell.update-button': { target: 'reloading' },
                  'platform.tab-hidden': {
                    target: 'reloading',
                    guard: 'quietReload',
                    actions: 'markSelfReload',
                  },
                },
              },
              reloading: {
                invoke: { src: 'platform.reload', onDone: { target: 'crashed' } },
              },
              updating: {
                invoke: { src: 'platform.reload', onDone: { target: 'ready' } },
              },
            },
          },
          install: {
            initial: 'offering',
            states: {
              // The reminder's buttons are taken only while the screen shows as usual.
              offering: {
                on: {
                  'app-shell.install-button': { target: 'installing', guard: 'screenReady' },
                  'app-shell.install-later-button': { target: 'postponing', guard: 'screenReady' },
                },
              },
              installing: {
                invoke: {
                  src: 'platform.install.prompt',
                  onDone: { target: 'offering', actions: INSTALL_GONE },
                  onError: { target: 'offering', actions: INSTALL_GONE },
                },
              },
              postponing: {
                invoke: {
                  src: 'platform.install.postpone',
                  onDone: { target: 'offering', actions: INSTALL_GONE },
                },
              },
            },
          },
        },
      },
      failed: {
        meta: { renders: ['app-shell.sign-out-here-button'] },
        on: {
          'app-shell.sign-out-here-button': { target: 'signing-out' },
          'platform.signed-in': SIGNED_IN,
          // The saved account went elsewhere: a guest's frame, with no sign-out of it offered.
          'platform.signed-out': { target: 'running', ...SIGNED_OUT },
          'app-shell.locale-select': { target: 'failed', actions: 'speakChoice' },
          'app-shell.theme-select': THEME_CHOSEN,
          'platform.theme-set': { actions: 'followTheme' },
        },
      },
      'signing-out': {
        meta: { renders: ['app-shell.sign-out-here-button'] },
        invoke: {
          src: 'platform.sign-out',
          onDone: { target: 'signed-out', actions: TO_SIGN_IN },
          onError: { target: 'signed-out', actions: TO_SIGN_IN },
        },
      },
      'start-failed': {
        on: {
          'app-shell.locale-select': { target: 'start-failed', actions: 'speakChoice' },
          'app-shell.theme-select': THEME_CHOSEN,
        },
      },
      'storage-blocked': { type: 'final' },
      'signed-out': { type: 'final' },
    },
  })
}
