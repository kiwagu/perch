/**
 * What a field does to know whether it holds unsaved input: it remembers the last value the
 * app gave it (the `value` prop whenever it did not come from the field's own last change, or
 * the `defaultValue` at mount) and is unsaved while its current value differs from it. It
 * reports to the scope's channel, and lets its form mark the value a saved submit took.
 *
 * A render only reads: what the field was given and what it showed are written once React
 * commits, so a render React abandons (a transition that never commits) leaves no trace.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useFormScope } from './form-scope'
import { useUnsavedInputChannel } from './scope'

export interface TrackedInput {
  /** False for a field whose own change runs its action: it never holds unsaved input. */
  readonly holdsInput: boolean
  /** The controlled value, as text; undefined for an uncontrolled field. */
  readonly value: string | undefined
  readonly defaultValue: string | undefined
}

const bump = (count: number): number => count + 1

export function useTracksInput(input: TrackedInput): { readonly typed: (next: string) => void } {
  const channel = useUnsavedInputChannel()
  const form = useFormScope()
  const [id] = useState(() => Symbol('field'))
  const [uncontrolled, setUncontrolled] = useState(input.defaultValue ?? '')
  const [, rerender] = useState(0)
  // As of the last commit: the last value the app gave the field, and what it showed.
  const given = useRef(input.value ?? input.defaultValue ?? '')
  const shown = useRef(given.current)
  // What the field's own last change was; set by the change, before the render it causes.
  const typedLast = useRef<string | undefined>(undefined)

  const current = input.value ?? uncontrolled
  const givenNow =
    input.value !== undefined && input.value !== typedLast.current ? input.value : given.current
  const unsaved = input.holdsInput && current !== givenNow

  useLayoutEffect(() => {
    given.current = givenNow
    shown.current = current
  })
  useEffect(() => {
    channel?.report(id, unsaved)
  }, [channel, id, unsaved])
  useEffect(() => () => channel?.forget(id), [channel, id])

  const capture = useCallback(() => {
    const submitted = shown.current

    return () => {
      given.current = submitted
      rerender(bump)
    }
  }, [])

  useEffect(() => form?.enlist(capture), [form, capture])

  const typed = useCallback((next: string) => {
    typedLast.current = next
    setUncontrolled(next)
  }, [])

  return { typed }
}
