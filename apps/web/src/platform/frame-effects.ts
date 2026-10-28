/**
 * The frame's anchors as the effects of any machine: a `show` on the toast pushes a toast, a
 * `show` on the notice sets it, a `clear` of the notice takes it away. The hook of every screen's
 * machine runs it, and the frame for its own; a screen's own anchors (its errors) are its
 * container's to read from the machine's context. A frame `show` carries one code: a machine
 * narrows a list before it emits, as it does for its errors.
 */

import { useEffect } from 'react'
import type { AnyActorRef } from 'xstate'

import { useClearNotice, useNotify } from './notices'
import { usePushToast } from './toasts'

export const FRAME_TOAST = 'app-shell.toast'
export const FRAME_NOTICE = 'app-shell.notice-message'

export interface FrameChannels {
  readonly notify: (code: string) => void
  readonly clear: () => void
  readonly pushToast: (code: string) => void
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** One effect a machine emitted, routed to the frame's channel it names; any other is left. */
export function routeFrameEffect(event: unknown, channels: FrameChannels): void {
  if (!isRecord(event)) {
    return
  }

  const { type, anchor, codes } = event

  if (type === 'clear' && anchor === FRAME_NOTICE) {
    channels.clear()

    return
  }

  if (type !== 'show' || (anchor !== FRAME_TOAST && anchor !== FRAME_NOTICE)) {
    return
  }

  const list = Array.isArray(codes)
    ? codes.filter((code: unknown): code is string => typeof code === 'string')
    : []
  const [code, ...more] = list

  if (code === undefined || more.length > 0) {
    throw new Error(`a show on ${anchor} carries one code, not ${list.join(', ')}`)
  }

  if (anchor === FRAME_TOAST) {
    channels.pushToast(code)
  } else {
    channels.notify(code)
  }
}

/**
 * Runs the frame's effects `actor` emits, for as long as the component that holds it lives. It
 * only subscribes, so a channel that changes identity (the notice's `notify` after a clear)
 * subscribes again and sends nothing.
 */
export function useFrameEffects(actor: Pick<AnyActorRef, 'on'>): void {
  const notify = useNotify()
  const clear = useClearNotice()
  const pushToast = usePushToast()

  useEffect(() => {
    const channels = { notify, clear, pushToast }
    const shown = actor.on('show', (event: unknown) => routeFrameEffect(event, channels))
    const cleared = actor.on('clear', (event: unknown) => routeFrameEffect(event, channels))

    return () => {
      shown.unsubscribe()
      cleared.unsubscribe()
    }
  }, [actor, notify, clear, pushToast])
}
