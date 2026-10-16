import { Link, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useSyncExternalStore } from 'react'

import { useSetLocale } from '../../../../platform/i18n'
import { useService } from '../../../../platform/module'
import { useNotice } from '../../../../platform/notices'
import { SESSION } from '../../../../platform/session.port'

import { type ShellLinkProps, ShellView } from './shell.view'

const RouterLink = ({ to, ...props }: ShellLinkProps) => <Link to={to} {...props} />

export function ShellContainer(props: { readonly children?: ReactNode }) {
  const session = useService(SESSION)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const setLocale = useSetLocale()
  const notice = useNotice()

  return (
    <ShellView
      status="ready"
      signedIn={user !== undefined}
      activePath={pathname}
      onLocaleChange={setLocale}
      link={RouterLink}
      notice={notice}
    >
      {props.children}
    </ShellView>
  )
}
