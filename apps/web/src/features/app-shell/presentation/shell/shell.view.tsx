import type { ComponentType, ReactNode } from 'react'
import { match } from 'ts-pattern'

import { type Locale, SUPPORTED_LOCALES, useLocale, useT } from '@workspace/i18n'
import { AppShell } from '@workspace/ui/components/platform/app-shell'
import { navItemVariants } from '@workspace/ui/components/platform/nav-item'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Toast, Toaster } from '@workspace/ui/components/ui/toast'

import type { SyncStatus } from '../../../../platform/sync-status.port'
import { THEMES, type Theme } from '../../../../platform/theme'
import type { ToastTone } from '../../../../platform/toasts'

export interface ShellLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'aria-current'?: 'page' | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

export interface ShellViewProps {
  /** Where the start is: opening the data, ready, failed, or stopped because the browser keeps no site data. */
  readonly status: 'opening' | 'ready' | 'failed' | 'storage-blocked'
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
  /** Signs the saved account out on this device when its data could not be opened; offered while `failed`. */
  readonly onSignOutHere?: (() => void) | undefined
  /** That sign-out runs: the button waits for it. */
  readonly signingOutHere?: boolean | undefined
  /** The latest message for the user: its contract code and its text, already translated. */
  readonly notice?: { readonly code: string; readonly text: string } | undefined
  /** The toasts shown, the newest first, each with its tone and its words in the language the app speaks. */
  readonly toasts?:
    | readonly {
        readonly id: number
        readonly code: string
        readonly tone: ToastTone
        readonly text: string
      }[]
    | undefined
  readonly onDismissToast?: ((id: number) => void) | undefined
  /** The code the crash message shows while the open screen failed to render; none otherwise. */
  readonly crash?: 'screen-crashed' | undefined
  /** Whether the frame's flow takes a reload now: the button is enabled while it does. */
  readonly canReload?: boolean | undefined
  readonly onReload?: (() => void) | undefined
  /** The code the update message shows once the page should load again; none before. */
  readonly update?: 'new-version' | 'protocol-outdated' | undefined
  /** Whether the frame's flow takes the update's reload now: the button is enabled while it does. */
  readonly canUpdate?: boolean | undefined
  readonly onUpdate?: (() => void) | undefined
  /** The code the state of the sync shows for a signed-in account; none for a guest. */
  readonly sync?: SyncStatus | undefined
  /** The code the reminder to install the app shows until it is installed or put off; none else. */
  readonly install?: 'install-available' | 'install-by-steps' | undefined
  /** Whether the frame's flow takes the install now: its button is enabled while it does. */
  readonly canInstall?: boolean | undefined
  readonly onInstall?: (() => void) | undefined
  /** Whether the frame's flow takes the reminder put off now. */
  readonly canPostponeInstall?: boolean | undefined
  readonly onPostponeInstall?: (() => void) | undefined
  readonly children?: ReactNode
}

const PlainLink = ({ to, ...props }: ShellLinkProps) => <a href={to} {...props} />

export function ShellView(props: ShellViewProps) {
  const t = useT()
  const locale = useLocale()
  const Link = props.link ?? PlainLink
  const items = props.signedIn
    ? [
        { to: '/me', label: t('app.shell.nav.profile'), testId: 'app-shell.nav.profile-link' },
        {
          to: '/org',
          label: t('app.shell.nav.organisation'),
          testId: 'app-shell.nav.organisation-link',
        },
        {
          to: '/devices',
          label: t('app.shell.nav.devices'),
          testId: 'app-shell.nav.devices-link',
        },
        {
          to: '/settings',
          label: t('app.shell.nav.settings'),
          testId: 'app-shell.nav.settings-link',
        },
      ]
    : [
        {
          to: '/sign-in',
          label: t('app.shell.nav.sign-in'),
          testId: 'app-shell.nav.sign-in-link',
        },
      ]
  const themes = THEMES.map((theme) => ({
    value: theme,
    label:
      theme === 'light'
        ? t('app.shell.theme.light')
        : theme === 'dark'
          ? t('app.shell.theme.dark')
          : t('app.shell.theme.system'),
  }))
  const locales = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: locale === 'en' ? t('app.shell.locale.en') : t('app.shell.locale.es'),
  }))
  // One status line: visually hidden once ready, the visible message otherwise.
  const status = (
    <p
      className={props.status === 'ready' ? 'sr-only' : 'text-muted-foreground'}
      data-testid="app-shell.status"
      data-state={props.status}
      role="status"
    >
      {match(props.status)
        .with('ready', () => t('app.shell.sync.local'))
        .with('opening', () => t('app.shell.opening-db'))
        .with('storage-blocked', () => t('app.shell.storage-blocked'))
        .with('failed', () => t('app.shell.failed'))
        .exhaustive()}
    </p>
  )

  return (
    <AppShell
      brand={t('app.shell.title')}
      navigationLabel={t('app.shell.navigation')}
      navigationTestId="app-shell.nav"
      actions={
        <>
          {/* A signed-in account sees the state of this device's sync; on a phone it takes two
              short lines at most, so the header never scrolls sideways. */}
          {props.status === 'ready' && props.sync ? (
            <p
              className="max-w-24 text-right text-xs leading-tight text-muted-foreground sm:max-w-none"
              role="status"
              data-testid="app-shell.sync-message"
              data-code={props.sync}
            >
              {match(props.sync)
                .with('synced', () => t('app.shell.sync.synced'))
                .with('sending', () => t('app.shell.sync.sending'))
                .with('connecting', () => t('app.shell.sync.connecting'))
                .with('offline', () => t('app.shell.sync.offline'))
                .with('sync-stopped', () => t('app.shell.sync.sync-stopped'))
                .exhaustive()}
            </p>
          ) : null}
          {/* Anyone chooses the theme of this device here, as on the settings screen. */}
          <OptionSelect
            label={t('app.shell.theme')}
            value={props.theme}
            options={themes}
            onChange={props.onThemeChange}
            disabled={!props.canChooseTheme}
            testId="app-shell.theme-select"
            holdsInput={false}
          />
          {/* A guest chooses the language here; a signed-in account does on its settings screen. */}
          {props.signedIn ? null : (
            <OptionSelect
              label={t('app.shell.locale')}
              value={locale}
              options={locales}
              onChange={props.onLocaleChange}
              disabled={!props.canChooseLocale}
              testId="app-shell.locale-select"
              holdsInput={false}
            />
          )}
        </>
      }
      navigation={items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          data-testid={item.testId}
          aria-current={props.activePath === item.to ? 'page' : undefined}
          className={navItemVariants({ active: props.activePath === item.to })}
        >
          {item.label}
        </Link>
      ))}
      status={status}
    >
      {/* The notice's line is held, as tall as the longest notice (three lines on a phone, two
          wider up; `texts-contract.spec.ts` keeps every notice within it), so the page below does
          not move when a notice comes, changes or goes. */}
      {props.status === 'ready' && props.update ? (
        <Alert variant={props.update === 'protocol-outdated' ? 'destructive' : 'default'}>
          <AlertDescription data-testid="app-shell.update-message" data-code={props.update}>
            {match(props.update)
              .with('new-version', () => t('app.shell.update.new-version'))
              .with('protocol-outdated', () => t('app.shell.update.protocol-outdated'))
              .exhaustive()}
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 justify-self-start"
            disabled={!props.canUpdate}
            onClick={props.onUpdate}
            data-testid="app-shell.update-button"
          >
            {t('app.shell.reload')}
          </Button>
        </Alert>
      ) : null}
      {props.status === 'ready' && props.install ? (
        <Alert>
          <AlertDescription data-testid="app-shell.install-message" data-code={props.install}>
            {match(props.install)
              .with('install-available', () => t('app.shell.install.available'))
              .with('install-by-steps', () => t('app.shell.install.by-steps'))
              .exhaustive()}
          </AlertDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {props.install === 'install-available' ? (
              <Button
                type="button"
                size="sm"
                disabled={!props.canInstall}
                onClick={props.onInstall}
                data-testid="app-shell.install-button"
              >
                {t('app.shell.install.install')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!props.canPostponeInstall}
              onClick={props.onPostponeInstall}
              data-testid="app-shell.install-later-button"
            >
              {t('app.shell.install.later')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div data-slot="notice" className="min-h-15 sm:min-h-10">
        {props.notice ? (
          <p
            className="text-sm text-muted-foreground"
            role="status"
            data-testid="app-shell.notice-message"
            data-code={props.notice.code}
          >
            {props.notice.text}
          </p>
        ) : null}
      </div>
      <Toaster>
        {(props.toasts ?? []).map((toast) => (
          <Toast
            key={toast.id}
            data-testid="app-shell.toast"
            code={toast.code}
            tone={toast.tone}
            onDismiss={() => props.onDismissToast?.(toast.id)}
          >
            {toast.text}
          </Toast>
        ))}
      </Toaster>
      {props.status === 'failed' && props.onSignOutHere ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={props.signingOutHere}
          onClick={props.onSignOutHere}
          data-testid="app-shell.sign-out-here-button"
        >
          {t('app.shell.sign-out-here')}
        </Button>
      ) : null}
      {props.status === 'ready' && props.crash ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm" data-testid="app-shell.crash-message" data-code={props.crash}>
            {t('app.shell.crash.screen-crashed')}
          </p>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={!props.canReload}
            onClick={props.onReload}
            data-testid="app-shell.reload-button"
          >
            {t('app.shell.reload')}
          </Button>
        </div>
      ) : null}
      {props.status === 'ready' ? props.children : null}
    </AppShell>
  )
}
