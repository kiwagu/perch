/**
 * A flow's `clear` of a field: the field returns to its empty value and holds no input any more,
 * as if nothing was typed, on the flow's own screen only. The codes come first: a machine keeps a
 * `clear` of an anchor that carries codes for itself (its error or message shows none) and emits
 * the clear of a field, which the screen's container empties here by setting the field's value
 * back to its empty one; the kit's field takes a value the app gives it as saved, so nothing
 * stays unsaved. A clear of an anchor the screen does not name here (the frame's notice) is
 * another channel's.
 */

import { useEffect, useRef } from 'react'
import type { AnyActorRef } from 'xstate'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** Empties each field `fields` names, by its anchor, when the machine emits its `clear`. */
export function useFieldClears(
  actor: Pick<AnyActorRef, 'on'>,
  fields: Readonly<Record<string, () => void>>,
): void {
  // The setters are read when a clear comes, so a render that makes new ones subscribes nothing.
  const current = useRef(fields)

  current.current = fields

  useEffect(() => {
    const cleared = actor.on('clear', (event: unknown) => {
      const anchor = isRecord(event) ? event['anchor'] : undefined

      if (typeof anchor === 'string') {
        current.current[anchor]?.()
      }
    })

    return () => cleared.unsubscribe()
  }, [actor])
}
