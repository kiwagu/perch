import type { ComponentType, ReactNode } from 'react'

import { useT } from '@workspace/i18n'
import { navItemVariants } from '@workspace/ui/components/platform/nav-item'

export interface ShellLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'aria-current'?: 'page' | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

const PlainLink = ({ to, ...props }: ShellLinkProps) => <a href={to} {...props} />

export interface NavigationLinksProps {
  /** What draws a link: the router's in the app, a plain anchor without one. */
  readonly link?: ComponentType<ShellLinkProps> | undefined
  readonly activePath: string
}

/** A signed-in account's navigation: a link to each of its screens, the open one marked current. */
export function NavigationLinks(props: NavigationLinksProps) {
  const t = useT()
  const Link = props.link ?? PlainLink
  const items = [
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

  return (
    <>
      {items.map((item) => (
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
    </>
  )
}
