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
import type {
  AnyActorRef,
  AnyMachineSnapshot,
  AnyStateMachine,
  EventFromLogic,
  InspectionEvent,
} from 'xstate'

import { useLeaveGuard } from './leave-guard.port'
import { isLeavingControl } from './leaving'

/**
 * A submit under way: whether the machine has taken its event yet, the actors it owns (those its
 * event started, and those an owned actor's end started in turn), whether one of them failed or
 * was stopped before it ended.
 */
interface Run {
  taken: boolean
  readonly owned: Set<string>
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

const DONE = 'xstate.done.actor.'
const FAILED = 'xstate.error.actor.'

/** The actor whose end an event of the root reports: its id, or none. */
const endedBy = (type: string): string | undefined =>
  type.startsWith(DONE)
    ? type.slice(DONE.length)
    : type.startsWith(FAILED)
      ? type.slice(FAILED.length)
      : undefined

/** The anchor an event of a screen's machine is named by. */
const controlOf = (event: { readonly type: unknown }): string =>
  typeof event.type === 'string' ? event.type : ''

export function useScreenMachine<TMachine extends AnyStateMachine>(machine: TMachine) {
  const navigate = useNavigate()
  const guard = useLeaveGuard()
  // Each snapshot of the root carries the event that made it: a submit's own event object, or
  // the end of an actor it owns. The actors that snapshot adds are that submit's; an owned actor
  // that leaves without its own end was stopped, which saved nothing.
  const runs = useRef(new Set<Run>())
  const byEvent = useRef(new WeakMap<object, Run>())
  const owners = useRef(new Map<string, Run>())
  const previous = useRef(new Set<string>())
  const inspect = useCallback((inspected: InspectionEvent) => {
    if (
      inspected.type !== '@xstate.snapshot' ||
      inspected.actorRef.sessionId !== inspected.rootId
    ) {
      return
    }

    const cause = inspected.event
    const ended = endedBy(cause.type)
    const own = byEvent.current.get(cause)
    const run = own ?? (ended === undefined ? undefined : owners.current.get(ended))
    const children = new Set(childrenOf(inspected.snapshot))

    if (own !== undefined) {
      own.taken = true
    }

    if (ended !== undefined && cause.type.startsWith(FAILED)) {
      const owner = owners.current.get(ended)

      if (owner !== undefined) {
        owner.failed = true
      }
    }

    for (const id of previous.current) {
      const owner = owners.current.get(id)

      if (!children.has(id) && owner !== undefined) {
        owners.current.delete(id)
        owner.owned.delete(id)
        owner.failed ||= id !== ended
      }
    }

    for (const id of children) {
      if (run !== undefined && !previous.current.has(id)) {
        owners.current.set(id, run)
        run.owned.add(id)
      }
    }

    previous.current = children

    for (const settled of runs.current) {
      if (settled.taken && settled.owned.size === 0) {
        runs.current.delete(settled)
        settled.settle(!settled.failed)
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

  /**
   * Sends `event` and resolves with the outcome of the actions it started, once the machine took
   * it: `false` when the state does not take it, at once when it started none.
   */
  const start = useCallback(
    (event: EventFromLogic<TMachine>) =>
      new Promise<boolean>((settle) => {
        const now: AnyMachineSnapshot = actor.getSnapshot()

        if (!now.can(event)) {
          settle(false)

          return
        }

        const run: Run = { taken: false, owned: new Set(), failed: false, settle }

        runs.current.add(run)
        byEvent.current.set(event, run)
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
