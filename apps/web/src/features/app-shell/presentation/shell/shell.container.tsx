import { Link, useRouterState } from '@tanstack/react-router'
import { useSelector } from '@xstate/react'
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react'

import { useT } from '@workspace/i18n'

import { useService, useShape } from '../../../../platform/module'
import { useClearNotice, useNotice, useNotify } from '../../../../platform/notices'
import { SESSION } from '../../../../platform/session.port'
import { settingsShape } from '../../../user/application/settings/settings.model.gen'
import { SETTINGS_SERVICE } from '../../../user/application/settings/settings.service'
import { LocaleWrites } from '../../application/locale-writes'

import { type ShellLinkProps, ShellView } from './shell.view'
import { useShellFrame } from './shell-frame'

const RouterLink = ({ to, ...props }: ShellLinkProps) => <Link to={to} {...props} />

export function ShellContainer(props: { readonly children?: ReactNode }) {
  const session = useService(SESSION)
  const settings = useService(SETTINGS_SERVICE)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const { actor, live } = useShellFrame()
  const row = useShape(settingsShape, user ? { identity: user.id } : null).tree?.[0]
  const account = useRef<string | undefined>(undefined)
  const signedInAs = useRef<string | undefined>(undefined)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const notice = useNotice()
  const notify = useNotify()
  const clearNotice = useClearNotice()
  const t = useT()

  // What the frame's machine reads, current before it is asked anything below: the account signed
  // in, the language its settings hold here, how to store one; another account, or none, starts
  // knowing nothing of its stored language.
  if (account.current !== user?.id) {
    account.current = user?.id
    live.session += 1
    live.writes = LocaleWrites.none
  }

  live.account = user?.id
  live.stored = row?.locale
  live.store = row ? (locale) => settings.updateLocale({ id: row.id, locale }) : undefined

  // Rendered again on every step of the machine; the select is enabled while its state takes a choice.
  useSelector(actor, (state) => state)
  const canChoose = actor.getSnapshot().can({ type: 'app-shell.locale-select', locale: 'en' })

  // The stored language arriving or changing, here or from another device: the frame's data event.
  const stored = row?.locale

  useEffect(() => {
    if (stored === undefined) {
      return
    }

    actor.send({ type: 'model.settings.locale' })
    live.writes = live.writes.arrived(stored)
  }, [user?.id, stored, actor, live])

  // The account going away, by its own sign-out or from another device: the frame's platform event.
  useEffect(() => {
    const before = signedInAs.current

    signedInAs.current = user?.id

    if (before !== undefined && user?.id === undefined) {
      actor.send({ type: 'platform.signed-out' })
    }
  }, [user?.id, actor])

  useEffect(() => {
    const shown = actor.on('show', ({ codes }) => {
      if (codes.includes('locale-not-stored')) {
        notify({ code: 'locale-not-stored', text: (t) => t('app.shell.locale-not-stored') })
      }
    })
    const cleared = actor.on('clear', ({ anchor }) => {
      if (anchor === 'app-shell.notice-message') {
        clearNotice()
      }
    })

    return () => {
      shown.unsubscribe()
      cleared.unsubscribe()
    }
  }, [actor, notify, clearNotice])

  useEffect(
    () =>
      session.subscribeRejections((rejection) =>
        notify(
          rejection.reloaded
            ? { code: 'changes-reloaded', text: (t) => t('app.shell.reloaded') }
            : { code: 'change-rejected', text: (t) => t('app.shell.rejected') },
        ),
      ),
    [session, notify],
  )

  return (
    <ShellView
      status="ready"
      signedIn={user !== undefined}
      activePath={pathname}
      canChooseLocale={canChoose}
      onLocaleChange={(locale) => actor.send({ type: 'app-shell.locale-select', locale })}
      link={RouterLink}
      notice={notice && { code: notice.code, text: notice.text(t) }}
    >
      {props.children}
    </ShellView>
  )
}
