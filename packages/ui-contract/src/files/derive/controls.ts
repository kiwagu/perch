/**
 * The controls of a screen whose region the flow may leave to the loader: each `button` bound
 * to exactly one action, with the error anchor of its part (`<part>.error`) when the screen
 * declares one, in the order the anchors are declared.
 */

import { entriesOf, isRecord, listOf, recordOf } from '../../records'

/** A button that runs one action. */
export interface Control {
  /** The button, whose event starts the action. */
  readonly anchor: string
  /** The action its binding runs. */
  readonly src: string
  /** The parameters its binding passes, the input of the invoke. */
  readonly input: Readonly<Record<string, unknown>> | undefined
  /** The error anchor of its part, when the screen declares one. */
  readonly error: string | undefined
}

const BUTTON = 'button'

/** The controls of `screen` as read, after its error anchors are derived. */
export function controlsOf(screen: unknown): readonly Control[] {
  const anchors = recordOf(recordOf(screen)['anchors'])

  return entriesOf(anchors).flatMap(([anchor, def]): Control[] => {
    const refs = listOf(recordOf(def)['binding'])
    const [ref] = refs

    if (recordOf(def)['kind'] !== BUTTON || refs.length !== 1 || !isRecord(ref)) {
      return []
    }

    const { action, params } = ref
    const error = `${anchor.slice(0, anchor.lastIndexOf('.'))}.error`

    return typeof action === 'string'
      ? [
          {
            anchor,
            src: action,
            input: isRecord(params) ? params : undefined,
            error: isRecord(anchors[error]) ? error : undefined,
          },
        ]
      : []
  })
}
