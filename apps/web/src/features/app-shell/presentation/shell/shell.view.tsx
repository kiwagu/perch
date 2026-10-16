import type { ComponentType, ReactNode } from 'react'

import { type Locale, SUPPORTED_LOCALES, useLocale, useT } from '@workspace/i18n'
import { AppShell } from '@workspace/ui/components/platform/app-shell'
import { navItemVariants } from '@workspace/ui/components/platform/nav-item'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'

export interface ShellLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'aria-current'?: 'page' | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

export interface ShellViewProps {
  readonly status: 'opening' | 'ready' | 'failed'
  readonly signedIn: boolean
  readonly activePath: string
  readonly onLocaleChange: (locale: Locale) => void
  readonly link?: ComponentType<ShellLinkProps>
  readonly children?: ReactNode
}

const PlainLink = ({ to, ...props }: ShellLinkProps) => <a href={to} {...props} />

export function ShellView(props: ShellViewProps) {
  const t = useT()
  const locale = useLocale()
  const Link = props.link ?? PlainLink
  const items = props.signedIn
    ? [{ to: '/me', label: t('app.shell.nav.profile'), testId: 'app-shell.nav.profile' }]
    : [{ to: '/sign-in', label: t('app.shell.nav.sign-in'), testId: 'app-shell.nav.sign-in' }]
  const locales = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: locale === 'en' ? t('app.shell.locale.en') : t('app.shell.locale.es'),
  }))
  const status =
    props.status === 'ready' ? (
      <span className="sr-only" data-testid="app-shell.ready">
        {t('app.shell.sync.local')}
      </span>
    ) : (
      <p className="text-muted-foreground" data-testid="app-shell.opening" role="status">
        {props.status === 'opening' ? t('app.shell.opening-db') : t('app.shell.failed')}
      </p>
    )

  return (
    <AppShell
      brand={t('app.shell.title')}
      navigationLabel={t('app.shell.navigation')}
      actions={
        <OptionSelect
          label={t('app.shell.locale')}
          value={locale}
          options={locales}
          onChange={props.onLocaleChange}
          testId="app-shell.locale"
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
      {props.status === 'ready' ? props.children : null}
    </AppShell>
  )
}
