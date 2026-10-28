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

export interface TrackedInput<Value> {
  /** False for a field whose own change runs its action: it never holds unsaved input. */
  readonly holdsInput: boolean
  /** The controlled value; undefined for an uncontrolled field. */
  readonly value: Value | undefined
  /** What an uncontrolled field starts with: its default value, else its empty one. */
  readonly defaultValue: Value
  /** Whether two values are the same; `Object.is` when left out. */
  readonly same?: ((a: Value, b: Value) => boolean) | undefined
}

const bump = (count: number): number => count + 1

export function useTracksInput<Value>(input: TrackedInput<Value>): {
  readonly typed: (next: Value) => void
} {
  const channel = useUnsavedInputChannel()
  const form = useFormScope()
  const same = input.same ?? Object.is
  const [id] = useState(() => Symbol('field'))
  const [uncontrolled, setUncontrolled] = useState(() => input.defaultValue)
  const [, rerender] = useState(0)
  // As of the last commit: the last value the app gave the field, and what it showed.
  const given = useRef(input.value === undefined ? input.defaultValue : input.value)
  const shown = useRef(given.current)
  // What the field's own last change was; set by the change, before the render it causes.
  const typedLast = useRef<{ readonly value: Value } | undefined>(undefined)

  const current = input.value === undefined ? uncontrolled : input.value
  const echoed =
    input.value !== undefined &&
    typedLast.current !== undefined &&
    same(input.value, typedLast.current.value)
  const givenNow = input.value !== undefined && !echoed ? input.value : given.current
  const unsaved = input.holdsInput && !same(current, givenNow)

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

  const typed = useCallback((next: Value) => {
    typedLast.current = { value: next }
    setUncontrolled(() => next)
  }, [])

  return { typed }
}
