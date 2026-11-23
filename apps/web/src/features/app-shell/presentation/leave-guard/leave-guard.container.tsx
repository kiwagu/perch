/**
 * The frame's guard of unsaved input, as the platform's `unsavedInput` declares it (`LEAVE_POLICY`):
 * while a field holds unsaved input it asks through `app-shell.leave-dialog` before another
 * screen opens and before a leaving control runs, and before a control whose flow moves to another
 * screen while a field that move loses holds it (one that renders no anchor counts: no move carries
 * it), and lets the browser ask before a reload, a
 * closed tab or an address typed by hand. A change of state inside one screen never asks, a
 * flow's own navigation passes (`useScreenMachine`), and a leave nobody started here cannot ask.
 */

import { useBlocker, useRouterState } from '@tanstack/react-router'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useT } from '@workspace/i18n'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'
import { useUnsavedFields, useUnsavedInput } from '@workspace/ui/unsaved-input'

import { type LeaveGuard as Guard, LeaveGuardContext } from '../../../../platform/leave-guard.port'
import { isLeavingControl, LEAVE_POLICY, lossOf } from '../../../../platform/leaving'

/** A question on screen, waiting for the user's answer: leave (true) or stay (false). */
interface Asking {
  readonly settle: (leave: boolean) => void
}

/** Where a move starts or ends, as the router's blocker gives it. */
interface Place {
  readonly pathname: string
  readonly search: unknown
}

/** Whether a move leaves what the policy guards: another screen, or with `state` any other place. */
const leaves = (current: Place, next: Place): boolean =>
  current.pathname !== next.pathname ||
  (LEAVE_POLICY.state === 'question' &&
    JSON.stringify(current.search) !== JSON.stringify(next.search))

export function LeaveGuard(props: { readonly children: ReactNode }) {
  const t = useT()
  const unsaved = useUnsavedInput()
  const unsavedFields = useUnsavedFields()
  const unsavedNow = useRef(unsaved)
  const pending = useRef<Asking | undefined>(undefined)
  const [asking, setAsking] = useState<Asking | undefined>(undefined)

  useLayoutEffect(() => {
    unsavedNow.current = unsaved
  })

  // A second question replaces the first, which the user did not answer: that leave stays.
  const question = useCallback(() => {
    pending.current?.settle(false)

    return new Promise<boolean>((settle) => {
      const asked = { settle }

      pending.current = asked
      setAsking(asked)
    })
  }, [])
  const confirm = useCallback(
    () => (unsavedNow.current ? question() : Promise.resolve(true)),
    [question],
  )
  /** Asks before a move that loses `loses` while one of them, or a field of no anchor, is unsaved. */
  const beforeLosing = useCallback(
    (loses: readonly string[]) => {
      const { anchors, unnamed } = unsavedFields()

      return unnamed || loses.some((field) => anchors.has(field))
        ? question()
        : Promise.resolve(true)
    },
    [question, unsavedFields],
  )
  const guard = useMemo<Guard>(
    () => ({
      confirm,
      before: (control) => {
        const loses = lossOf(control)

        if (LEAVE_POLICY.actions === 'question' && isLeavingControl(control)) {
          return confirm()
        }

        return LEAVE_POLICY.screen === 'question' && loses !== undefined
          ? beforeLosing(loses)
          : Promise.resolve(true)
      },
    }),
    [beforeLosing, confirm],
  )

  useBlocker({
    shouldBlockFn: async ({ current, next }) =>
      LEAVE_POLICY.screen === 'question' && leaves(current, next) && !(await confirm()),
    enableBeforeUnload: () => LEAVE_POLICY.unload === 'browser' && unsavedNow.current,
  })

  const answer = useCallback((leave: boolean) => {
    pending.current?.settle(leave)
    pending.current = undefined
    setAsking(undefined)
  }, [])
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // A leave nobody started here (a sign-out elsewhere) moved the page under an open question: the
  // leave it asked about can no longer go on, so it stays.
  useEffect(() => {
    answer(false)
  }, [pathname, answer])

  return (
    <LeaveGuardContext.Provider value={guard}>
      {props.children}
      <ConfirmDialog
        open={asking !== undefined}
        title={t('app.shell.leave.title')}
        description={t('app.shell.leave.body')}
        confirmLabel={t('app.shell.leave.leave')}
        cancelLabel={t('app.shell.leave.stay')}
        destructive
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
        testId="app-shell.leave-dialog"
        code="unsaved-input"
      />
    </LeaveGuardContext.Provider>
  )
}
