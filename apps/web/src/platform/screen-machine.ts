/**
 * The one way a screen runs its machine. The hook runs the flow's `navigate` effects past the
 * frame's guard (the action that used the input completed), asks the guard before a leaving
 * control's event, and lets a form await the outcome of what an event started: `submit`
 * resolves once no action the event started is still running, `true` when none failed (a chain
 * of actions counts as one). It reads that from XState's inspection, so no flow changes for it.
 * It also runs the flow's effects on the frame (`frame-effects.ts`): a toast, the notice and its
 * clearing, so no container subscribes to them by hand.
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

import { useFrameEffects } from './frame-effects'
import { useLeaveGuard } from './leave-guard.port'
import { isLeavingControl } from './leaving'

/**
 * A submit under way: whether the machine took its event yet and whether that event selected a
 * transition, the actor instances it owns (those its event started, and those an owned actor's
 * end started in turn), whether one of them failed or was stopped before it ended.
 */
interface Run {
  taken: boolean
  accepted: boolean | undefined
  readonly owned: Set<string>
  failed: boolean
  readonly settle: (saved: boolean) => void
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** The actors a snapshot of the root runs: each instance's session id, by its id. */
const childrenOf = (snapshot: unknown): Map<string, string> =>
  new Map(
    Object.entries(
      isRecord(snapshot) && isRecord(snapshot['children']) ? snapshot['children'] : {},
    ).flatMap(([id, child]: [string, unknown]) =>
      isRecord(child) && typeof child['sessionId'] === 'string'
        ? [[id, child['sessionId']] as const]
        : [],
    ),
  )

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
  // Each step of the root carries the event that made it: a submit's own event object, or the end
  // of an actor instance a submit owns. Its first microstep says whether that event selected a
  // transition; the actor instances its snapshot adds belong to that submit, and an owned instance
  // that goes without its own end was stopped, which saved nothing.
  const runs = useRef(new Set<Run>())
  const byEvent = useRef(new WeakMap<object, Run>())
  const owners = useRef(new Map<string, Run>())
  const previous = useRef(new Map<string, string>())
  const inspect = useCallback((inspected: InspectionEvent) => {
    if (inspected.actorRef.sessionId !== inspected.rootId) {
      return
    }

    if (inspected.type === '@xstate.microstep') {
      const own = byEvent.current.get(inspected.event)

      if (own !== undefined && own.accepted === undefined) {
        own.accepted = inspected._transitions.length > 0
      }

      return
    }

    if (inspected.type !== '@xstate.snapshot') {
      return
    }

    const cause = inspected.event
    const ended = endedBy(cause.type)
    const endedInstance = ended === undefined ? undefined : previous.current.get(ended)
    const own = byEvent.current.get(cause)
    const run = own ?? (endedInstance === undefined ? undefined : owners.current.get(endedInstance))
    const children = childrenOf(inspected.snapshot)

    if (own !== undefined) {
      own.taken = true
    }

    if (endedInstance !== undefined && cause.type.startsWith(FAILED)) {
      const owner = owners.current.get(endedInstance)

      if (owner !== undefined) {
        owner.failed = true
      }
    }

    for (const [id, instance] of previous.current) {
      const owner = owners.current.get(instance)

      if (children.get(id) !== instance && owner !== undefined) {
        owners.current.delete(instance)
        owner.owned.delete(instance)
        owner.failed ||= instance !== endedInstance
      }
    }

    for (const [id, instance] of children) {
      if (run !== undefined && previous.current.get(id) !== instance) {
        owners.current.set(instance, run)
        run.owned.add(instance)
      }
    }

    previous.current = children

    for (const settled of runs.current) {
      if (settled.taken && settled.owned.size === 0) {
        runs.current.delete(settled)
        settled.settle(settled.accepted === true && !settled.failed)
      }
    }
  }, [])
  const actor = useActorRef(machine, { inspect })
  const state = useSelector(actor, (snapshot) => snapshot)

  useFrameEffects(actor)

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

        const run: Run = {
          taken: false,
          accepted: undefined,
          owned: new Set(),
          failed: false,
          settle,
        }

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
