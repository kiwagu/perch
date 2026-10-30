/**
 * The frame's confirmation, as the contract derives it: before a control whose action destroys
 * what it acts on sends its event (`useScreenMachine`), it asks through `app-shell.confirmation`
 * with the code of that action (`confirmations.ts`); its confirm-button lets the event go,
 * its cancel-button drops it. Any other control goes ahead at once. A second question replaces
 * the first, which the user did not answer, and a move to another screen under an open question
 * drops it.
 */

import { useRouterState } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useT } from '@workspace/i18n'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'

import {
  ConfirmGuardContext,
  type ConfirmGuard as Guard,
} from '../../../../platform/confirm-guard.port'
import { questionOf } from '../../../../platform/confirmations'
import { entryOf } from '../../../../platform/texts'
import { CONFIRM_TEXTS } from '../shell/confirm-texts'

/** A question on screen, waiting for the user's answer: go on (true) or stay (false). */
interface Asking {
  readonly code: string
  readonly settle: (go: boolean) => void
}

export function ConfirmGuard(props: { readonly children: ReactNode }) {
  const t = useT()
  const pending = useRef<Asking | undefined>(undefined)
  const [asking, setAsking] = useState<Asking | undefined>(undefined)
  // The last question stays worded while the dialog closes.
  const [shown, setShown] = useState<string | undefined>(undefined)
  const answer = useCallback((go: boolean) => {
    pending.current?.settle(go)
    pending.current = undefined
    setAsking(undefined)
  }, [])
  const guard = useMemo<Guard>(
    () => ({
      before: (control) => {
        const code = questionOf(control)

        if (code === undefined) {
          return Promise.resolve(true)
        }

        // A second question replaces the first, which the user did not answer: that action stays.
        pending.current?.settle(false)

        return new Promise<boolean>((settle) => {
          const question = { code, settle }

          pending.current = question
          setAsking(question)
          setShown(code)
        })
      },
    }),
    [],
  )
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // Another screen opened under an open question: the action it asked about stays.
  useEffect(() => {
    answer(false)
  }, [pathname, answer])

  const words = shown === undefined ? undefined : entryOf(CONFIRM_TEXTS, shown, 'confirmation')

  return (
    <ConfirmGuardContext.Provider value={guard}>
      {props.children}
      <ConfirmDialog
        open={asking !== undefined}
        title={words?.title(t) ?? ''}
        description={words?.body(t) ?? ''}
        confirmLabel={words?.confirm(t) ?? ''}
        cancelLabel={t('app.shell.confirm.cancel')}
        destructive
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
        testId="app-shell.confirmation"
        {...(shown === undefined ? {} : { code: shown })}
      />
    </ConfirmGuardContext.Provider>
  )
}
