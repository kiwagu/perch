/**
 * The one way a screen runs its machine. The hook runs the flow's `navigate` effects past the
 * frame's guard (the action that used the input completed), asks the guard before a leaving
 * control's event, and lets a form await the outcome of what an event started: `submit`
 * resolves once no action the event started is still running, `true` when none failed (a chain
 * of actions counts as one). It reads that from XState's inspection, so no flow changes for it.
 */

import { useNavigate } from '@tanstack/react-router'
import { useActorRef, useSelector } from '@xstate/react'
import { useCallback, useEffect, useRef } from 'react'
import type { AnyActorRef, AnyStateMachine, EventFromLogic, InspectionEvent } from 'xstate'

import { useLeaveGuard } from './leave-guard.port'
import { isLeavingControl } from './leaving'

/** A submit under way: the actors running when it started, whether an action failed since. */
interface Run {
  readonly running: ReadonlySet<string>
  failed: boolean
  readonly settle: (saved: boolean) => void
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** The ids of the actors a snapshot of the root runs. */
const childrenOf = (snapshot: unknown): string[] =>
  isRecord(snapshot) && isRecord(snapshot['children']) ? Object.keys(snapshot['children']) : []

/** A flow's `navigate` effect: where to go, with its search when it gives one. */
const isNavigate = (
  event: unknown,
): event is { readonly to: string; readonly search?: Readonly<Record<string, unknown>> } =>
  isRecord(event) &&
  typeof event['to'] === 'string' &&
  (event['search'] === undefined || isRecord(event['search']))

const FAILED = 'xstate.error.actor.'

/** The anchor an event of a screen's machine is named by. */
const controlOf = (event: { readonly type: unknown }): string =>
  typeof event.type === 'string' ? event.type : ''

export function useScreenMachine<TMachine extends AnyStateMachine>(machine: TMachine) {
  const navigate = useNavigate()
  const guard = useLeaveGuard()
  const runs = useRef(new Set<Run>())
  const inspect = useCallback((event: InspectionEvent) => {
    if (event.actorRef.sessionId !== event.rootId) {
      return
    }

    if (event.type === '@xstate.event' && event.event.type.startsWith(FAILED)) {
      for (const run of runs.current) {
        run.failed = true
      }
    }

    if (event.type === '@xstate.snapshot') {
      const children = childrenOf(event.snapshot)

      for (const run of runs.current) {
        if (children.every((id) => run.running.has(id))) {
          runs.current.delete(run)
          run.settle(!run.failed)
        }
      }
    }
  }, [])
  const actor = useActorRef(machine, { inspect })
  const state = useSelector(actor, (snapshot) => snapshot)

  useEffect(() => {
    const emitter: Pick<AnyActorRef, 'on'> = actor
    const moved = emitter.on('navigate', (event: unknown) => {
      if (isNavigate(event)) {
        void navigate({
          to: event.to,
          ...(event.search === undefined ? {} : { search: event.search }),
          ignoreBlocker: true,
        })
      }
    })

    return () => moved.unsubscribe()
  }, [actor, navigate])

  /** Sends `event` and resolves with the outcome of what it started. */
  const start = useCallback(
    (event: EventFromLogic<TMachine>) =>
      new Promise<boolean>((settle) => {
        runs.current.add({
          running: new Set(childrenOf(actor.getSnapshot())),
          failed: false,
          settle,
        })
        actor.send(event)
      }),
    [actor],
  )
  const send = useCallback(
    (event: EventFromLogic<TMachine>) => {
      const control = controlOf(event)

      if (!isLeavingControl(control)) {
        actor.send(event)

        return
      }

      void guard.before(control).then((leave) => {
        if (leave) {
          actor.send(event)
        }
      })
    },
    [actor, guard],
  )
  const submit = useCallback(
    (event: EventFromLogic<TMachine>): Promise<boolean> => {
      const control = controlOf(event)

      return isLeavingControl(control)
        ? guard.before(control).then((leave) => leave && start(event))
        : start(event)
    },
    [guard, start],
  )

  return { state, send, submit, actor }
}
