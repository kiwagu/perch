/**
 * What a screen's flow says of its errors, read on the flow as written, before its expansion,
 * so an error's derived codes are known when the expansion shows them:
 *
 * - `shown`: the codes the flow shows on an anchor explicitly (`show: { <anchor>: [codes] }`
 *   or the full effect, in any `entry`, `exit` or transition), each once, in the order written;
 * - `invoked`: the actions whose failure the flow shows on an error, each with the parameters
 *   it passes, in the order written: an invoke whose written `onError` shows the error in any
 *   form; an invoke the request pattern shows on it (`requests.ts`), when its action fails with
 *   codes and either it writes no `onError` and has its way back, or its `onError` is its target
 *   alone; then a region written `by` a button whose `onError` shows the error, or is its target
 *   alone (the pattern shows it on the error of the button's part, else the screen's), through
 *   the button's binding (`controls.ts`).
 */

import { isRecord, listOf, recordOf } from '../../records'

import { controlsOf } from './controls'
import { type FailureOf, failureCodes, unionOf } from './failures'
import { partOf } from './form-params'
import { isBare, type Request, requestsOf } from './requests'

/** An action whose failure the flow shows on an error, with the parameters it passes. */
export interface Invoked {
  readonly action: string
  readonly params: Readonly<Record<string, unknown>>
}

export interface FlowSources {
  readonly shown: ReadonlyMap<string, readonly string[]>
  readonly invoked: ReadonlyMap<string, readonly Invoked[]>
}

const codesIn = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value)
    ? value.filter((code: unknown): code is string => typeof code === 'string')
    : undefined

/** The anchor a show effect names, in any of its forms, and the codes it names, if any. */
function showOf(
  effect: unknown,
): { anchor: string; codes: readonly string[] | undefined } | undefined {
  if (!isRecord(effect)) {
    return undefined
  }

  if (effect['type'] === 'show') {
    const { anchor, codes } = recordOf(effect['params'])

    return typeof anchor === 'string' ? { anchor, codes: codesIn(codes) } : undefined
  }

  const { show } = effect

  if (typeof show === 'string') {
    return { anchor: show, codes: undefined }
  }

  const entries = Object.entries(recordOf(show))
  const [only] = entries

  return entries.length === 1 && only !== undefined
    ? { anchor: only[0], codes: codesIn(only[1]) }
    : undefined
}

/** Every effect under `node`: entries, exits and the actions of every transition, at any depth. */
function effectsUnder(node: unknown, into: unknown[]): unknown[] {
  if (Array.isArray(node)) {
    for (const each of listOf(node)) {
      effectsUnder(each, into)
    }
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'entry' || key === 'exit' || key === 'actions') {
        into.push(...listOf(value))
      } else {
        effectsUnder(value, into)
      }
    }
  }

  return into
}

/** Every region written `by` a button under `node`, at any depth. */
function regionsUnder(node: unknown, into: Array<Readonly<Record<string, unknown>>>) {
  if (isRecord(node)) {
    if (typeof node['by'] === 'string') {
      into.push(node)
    }

    for (const each of Object.values(node)) {
      regionsUnder(each, into)
    }
  }

  return into
}

/** Whether an `onError` shows `error`, in any of its branches and forms. */
const showsError = (onError: unknown, error: string): boolean =>
  listOf(onError).some((branch) =>
    listOf(recordOf(branch)['actions']).some((effect) => showOf(effect)?.anchor === error),
  )

/** The error the request pattern shows the failure of `request` on, when it does. */
function defaultedOf(request: Request, failureOf: FailureOf): string | undefined {
  const { onError, back, error } = request
  const pattern = onError === undefined ? 'state' in back : isBare(onError)

  return pattern && 'anchor' in error && failureCodes(failureOf(request.src)).length > 0
    ? error.anchor
    : undefined
}

/** What the flow of `screen` (as read) shows on each anchor, and invokes against each error. */
export function flowSourcesOf(screen: unknown, failureOf: FailureOf): FlowSources {
  const { id, anchors, flow } = recordOf(screen)
  const name = typeof id === 'string' ? id : ''
  const shown = new Map<string, string[]>()
  const invoked = new Map<string, Invoked[]>()

  if (!isRecord(flow)) {
    return { shown, invoked }
  }

  for (const show of effectsUnder(flow['states'], []).map(showOf)) {
    if (show?.codes !== undefined) {
      shown.set(show.anchor, unionOf([shown.get(show.anchor) ?? [], show.codes]))
    }
  }

  const declared = recordOf(anchors)
  const errors = Object.keys(declared).filter(
    (anchor) => recordOf(declared[anchor])['kind'] === 'error',
  )
  const add = (shows: (error: string) => boolean, one: Invoked): void => {
    for (const error of errors.filter(shows)) {
      invoked.set(error, [...(invoked.get(error) ?? []), one])
    }
  }
  const isDeclared = (anchor: string): boolean => isRecord(declared[anchor])

  for (const request of requestsOf(flow, name, isDeclared)) {
    const defaulted = defaultedOf(request, failureOf)

    add((error) => error === defaulted || showsError(request.onError, error), {
      action: request.src,
      params: recordOf(recordOf(request.state['invoke'])['input']),
    })
  }

  const controls = controlsOf(screen)

  for (const { by, onError } of regionsUnder(flow['states'], [])) {
    const control = controls.find(({ anchor }) => anchor === by)

    if (control === undefined) {
      continue
    }

    // A bare onError keeps the pattern's show: on the error of the button's part, else the screen's.
    const defaulted =
      isBare(onError) && failureCodes(failureOf(control.src)).length > 0
        ? [`${partOf(control.anchor)}.error`, `${name}.error`].find(isDeclared)
        : undefined

    add((error) => error === defaulted || showsError(onError, error), {
      action: control.src,
      params: control.input ?? {},
    })
  }

  return { shown, invoked }
}
