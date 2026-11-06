import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { Locale } from '@workspace/i18n'

import { settled } from '../../../../platform/actor-outcome'
import type { ClearParams, NavigateParams, ShowParams } from '../../../../platform/flow-effects'
import type { Theme } from '../../../../platform/theme'

import type { ShellContext, ShellEmitted, ShellEvent, ShellMachineDeps } from './events'
import {
  CRASH_GONE,
  CRASHED,
  INSTALL_AVAILABLE,
  INSTALL_BY_STEPS,
  INSTALL_GONE,
  LOCALE_STORED,
  NEW_VERSION,
  PROTOCOL_OUTDATED,
  REJECTED,
  RELOADED,
  SIGNED_IN,
  SIGNED_OUT,
  SYNC,
  THEME_CHOSEN,
  THEME_SET,
  THEME_STORED,
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
      quietReload: ({ context }) =>
        context.pending !== undefined &&
        !deps.values().unsaved &&
        !deps.selfReloads.done(context.pending.update),
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
          'platform.started': [{ target: 'ready', guard: 'signedOut' }, { target: 'opening-data' }],
          'platform.start-failed': { target: 'start-failed' },
          'platform.storage-blocked': { target: 'storage-blocked' },
          'app-shell.locale-select': { target: 'opening', actions: 'speakChoice' },
          'app-shell.theme-select': THEME_CHOSEN,
        },
      },
      'opening-data': {
        meta: { renders: ['app-shell.nav'] },
        on: {
          'platform.opened': { target: 'ready' },
          'platform.open-failed': { target: 'failed' },
          'platform.signed-in': SIGNED_IN,
          // Nothing is left to open: a guest's frame, the account's notice gone with it.
          'platform.signed-out': { target: 'ready', ...SIGNED_OUT },
        },
      },
      ready: {
        meta: { renders: ['app-shell.nav'] },
        on: {
          'app-shell.locale-select': [
            { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
          ],
          'app-shell.theme-select': THEME_CHOSEN,
          'platform.theme-set': THEME_SET,
          'model.settings.locale': LOCALE_STORED,
          'model.settings.theme': THEME_STORED,
          'platform.signed-in': SIGNED_IN,
          'platform.signed-out': SIGNED_OUT,
          'platform.change-rejected': { actions: REJECTED },
          'platform.changes-reloaded': { actions: RELOADED },
          'platform.crashed': { target: 'crashed' },
          'platform.new-version': NEW_VERSION,
          'platform.protocol-refused': PROTOCOL_OUTDATED,
          'app-shell.update-button': { target: 'updating' },
          'platform.tab-hidden': {
            target: 'updating',
            guard: 'quietReload',
            actions: 'markSelfReload',
          },
          ...SYNC,
          'platform.install-offered': INSTALL_AVAILABLE,
          'platform.install-by-steps': INSTALL_BY_STEPS,
          'platform.installed': { actions: INSTALL_GONE },
          'app-shell.install-button': { target: 'installing' },
          'app-shell.install-later-button': { target: 'postponing' },
        },
      },
      crashed: {
        meta: { renders: ['app-shell.nav', 'app-shell.reload-button'] },
        entry: CRASHED,
        exit: CRASH_GONE,
        on: {
          'app-shell.reload-button': { target: 'reloading' },
          'platform.navigated': { target: 'ready' },
          'app-shell.locale-select': [
            { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
          ],
          'app-shell.theme-select': THEME_CHOSEN,
          'platform.theme-set': THEME_SET,
          'model.settings.locale': LOCALE_STORED,
          'model.settings.theme': THEME_STORED,
          'platform.signed-in': SIGNED_IN,
          'platform.signed-out': SIGNED_OUT,
          'platform.change-rejected': { actions: REJECTED },
          'platform.changes-reloaded': { actions: RELOADED },
          'platform.new-version': NEW_VERSION,
          'platform.protocol-refused': PROTOCOL_OUTDATED,
          'app-shell.update-button': { target: 'reloading' },
          'platform.tab-hidden': {
            target: 'reloading',
            guard: 'quietReload',
            actions: 'markSelfReload',
          },
          ...SYNC,
        },
      },
      reloading: {
        meta: { renders: ['app-shell.nav'] },
        on: { 'platform.signed-in': SIGNED_IN },
        invoke: { src: 'platform.reload', onDone: { target: 'crashed' } },
      },
      updating: {
        meta: { renders: ['app-shell.nav'] },
        on: { 'platform.signed-in': SIGNED_IN },
        invoke: { src: 'platform.reload', onDone: { target: 'ready' } },
      },
      installing: {
        meta: { renders: ['app-shell.nav'] },
        on: { 'platform.signed-in': SIGNED_IN },
        invoke: {
          src: 'platform.install.prompt',
          onDone: { target: 'ready', actions: INSTALL_GONE },
          onError: { target: 'ready', actions: INSTALL_GONE },
        },
      },
      postponing: {
        meta: { renders: ['app-shell.nav'] },
        on: { 'platform.signed-in': SIGNED_IN },
        invoke: {
          src: 'platform.install.postpone',
          onDone: { target: 'ready', actions: INSTALL_GONE },
        },
      },
      failed: {
        meta: { renders: ['app-shell.sign-out-here-button'] },
        on: {
          'app-shell.sign-out-here-button': { target: 'signing-out' },
          'platform.signed-in': SIGNED_IN,
          // The saved account went elsewhere: a guest's frame, with no sign-out of it offered.
          'platform.signed-out': { target: 'ready', ...SIGNED_OUT },
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
