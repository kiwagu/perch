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

/** A submit under way: the actors it started and still runs, whether one of them failed. */
interface Run {
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
  // Each actor a submit's event started, or one an actor of that submit started on its end, is
  // that submit's; the submit settles once it owns none, and fails if one of them failed.
  const owners = useRef(new Map<string, Run>())
  const sending = useRef<Run | undefined>(undefined)
  const inspect = useCallback((event: InspectionEvent) => {
    if (event.type !== '@xstate.snapshot' || event.actorRef.sessionId !== event.rootId) {
      return
    }

    const ended = endedBy(event.event.type)
    const owner = ended === undefined ? sending.current : owners.current.get(ended)
    const children = new Set(childrenOf(event.snapshot))

    if (owner !== undefined && event.event.type.startsWith(FAILED)) {
      owner.failed = true
    }

    for (const [id, run] of owners.current) {
      if (!children.has(id)) {
        owners.current.delete(id)
        run.owned.delete(id)
      }
    }

    if (owner !== undefined) {
      for (const id of children) {
        if (!owners.current.has(id) && (ended !== undefined || owner === sending.current)) {
          owners.current.set(id, owner)
          owner.owned.add(id)
        }
      }
    }

    if (ended !== undefined && owner !== undefined && owner.owned.size === 0) {
      owner.settle(!owner.failed)
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
   * Sends `event` and resolves with the outcome of the actions it started: `false` when the state
   * does not take it, at once when it started none.
   */
  const start = useCallback(
    (event: EventFromLogic<TMachine>) =>
      new Promise<boolean>((settle) => {
        const now: AnyMachineSnapshot = actor.getSnapshot()

        if (!now.can(event)) {
          settle(false)

          return
        }

        const run: Run = { owned: new Set(), failed: false, settle }
        // What the root already runs is not this submit's, whatever the event does to it.
        const before = new Set(childrenOf(now))

        sending.current = run
        actor.send(event)
        sending.current = undefined

        for (const id of before) {
          if (owners.current.get(id) === run) {
            owners.current.delete(id)
            run.owned.delete(id)
          }
        }

        if (run.owned.size === 0) {
          settle(!run.failed)
        }
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
