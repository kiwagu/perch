import { Link, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useSyncExternalStore } from 'react'

import { useT } from '@workspace/i18n'

import { useSetLocale } from '../../../../platform/i18n'
import { useService } from '../../../../platform/module'
import { useNotice, useNotify } from '../../../../platform/notices'
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
  const notify = useNotify()
  const t = useT()

  useEffect(
    () =>
      session.subscribeRejections((rejection) =>
        notify({
          testId: 'app-shell.notice',
          text: rejection.reloaded ? t('app.shell.reloaded') : t('app.shell.rejected'),
        }),
      ),
    [session, notify, t],
  )

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
