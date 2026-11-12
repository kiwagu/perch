import type { ComponentType, ReactNode } from 'react'

import { type Translate, useT } from '@workspace/i18n'
import { navItemVariants } from '@workspace/ui/components/platform/nav-item'
import { admits } from '@workspace/ui-contract/anchors'

export interface ShellLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'aria-current'?: 'page' | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

const PlainLink = ({ to, ...props }: ShellLinkProps) => <a href={to} {...props} />

/** A link of the navigation: its route, its anchor, the roles that see it, and its words. */
export interface NavigationLink {
  readonly to: string
  readonly testId: string
  /** Its anchor's roles in the frame's contract (`__root.yaml`): a device holding one sees it. */
  readonly roles: readonly string[]
  readonly label: (t: Translate) => string
}

/** The links of the navigation, in order; `navigation-links-contract.spec.ts` holds them to the frame's. */
export const NAVIGATION_LINKS: readonly NavigationLink[] = [
  {
    to: '/me',
    testId: 'app-shell.nav.profile-link',
    roles: ['identity', 'member', 'admin'],
    label: (t) => t('app.shell.nav.profile'),
  },
  {
    to: '/org',
    testId: 'app-shell.nav.organisation-link',
    roles: ['identity', 'member', 'admin'],
    label: (t) => t('app.shell.nav.organisation'),
  },
  {
    to: '/devices',
    testId: 'app-shell.nav.devices-link',
    roles: ['identity', 'member', 'admin'],
    label: (t) => t('app.shell.nav.devices'),
  },
  {
    to: '/settings',
    testId: 'app-shell.nav.settings-link',
    roles: ['identity', 'member', 'admin'],
    label: (t) => t('app.shell.nav.settings'),
  },
  {
    to: '/console/users',
    testId: 'app-shell.nav.console-link',
    roles: ['operator'],
    label: (t) => t('app.shell.nav.console'),
  },
]

export interface NavigationLinksProps {
  /** What draws a link: the router's in the app, a plain anchor without one. */
  readonly link?: ComponentType<ShellLinkProps> | undefined
  /** The path of the screen open, as the router resolved it: its link is marked current. */
  readonly activePath: string | undefined
  /** The roles this device holds (`heldRoles`): a link shows when its roles admit them. */
  readonly held: ReadonlySet<string>
}

/**
 * A signed-in account's navigation: a link to each of its screens its roles see (the console's to
 * an operator alone), the open one marked current.
 */
export function NavigationLinks(props: NavigationLinksProps) {
  const t = useT()
  const Link = props.link ?? PlainLink

  return (
    <>
      {NAVIGATION_LINKS.filter((item) => admits(item.roles, props.held)).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          data-testid={item.testId}
          aria-current={props.activePath === item.to ? 'page' : undefined}
          className={navItemVariants({ active: props.activePath === item.to })}
        >
          {item.label(t)}
        </Link>
      ))}
    </>
  )
}
