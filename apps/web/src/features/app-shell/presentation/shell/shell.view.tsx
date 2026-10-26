import type { ComponentType, ReactNode } from 'react'
import { match } from 'ts-pattern'

import { type Locale, SUPPORTED_LOCALES, useLocale, useT } from '@workspace/i18n'
import { AppShell } from '@workspace/ui/components/platform/app-shell'
import { navItemVariants } from '@workspace/ui/components/platform/nav-item'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'

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
  readonly link?: ComponentType<ShellLinkProps>
  /** Signs the saved account out on this device when its data could not be opened; offered while `failed`. */
  readonly onSignOutHere?: (() => void) | undefined
  /** That sign-out runs: the button waits for it. */
  readonly signingOutHere?: boolean | undefined
  /** The latest message for the user: its contract code and its text, already translated. */
  readonly notice?: { readonly code: string; readonly text: string } | undefined
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
      ]
    : [
        {
          to: '/sign-in',
          label: t('app.shell.nav.sign-in'),
          testId: 'app-shell.nav.sign-in-link',
        },
      ]
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
        <OptionSelect
          label={t('app.shell.locale')}
          value={locale}
          options={locales}
          onChange={props.onLocaleChange}
          disabled={!props.canChooseLocale}
          testId="app-shell.locale-select"
        />
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
      {props.status === 'ready' ? props.children : null}
    </AppShell>
  )
}
