/**
 * The codes and fields of an error anchor, derived when the screen file leaves them out. An
 * error `<part>.error` shows what three sources give, in this order:
 *
 * - the failures of the actions the anchors beside it bind (`<part>.<name>`, in the order they
 *   are declared, each binding in its order);
 * - the failures of the actions the screen's flow invokes and shows on the error, by a written
 *   `onError`, the request pattern or a region written `by` a button (`flow-errors.ts`), in the
 *   order the flow writes them;
 * - the codes the flow shows on the error explicitly, anywhere.
 *
 * So:
 *
 * - its `codes` are the codes of those sources, each once, `failed` last;
 * - its `fields` map each code a field of the model gives to the control that binding or invoke
 *   passes for the field's parameter, when that control is a field of the screen; a code two
 *   sources pass from two different controls concerns the form, so it is left out.
 *
 * What the file writes wins: written `codes` stay, and written `fields` stay. Derived fields
 * cover only the codes the anchor carries.
 */

import { FIELD_KINDS } from '../../anchors'
import { entriesOf, isRecord, listOf, recordOf } from '../../records'

import { type FailureOf, failureCodes, unionOf } from './failures'
import { type FlowSources, flowSourcesOf } from './flow-errors'

const ERROR = 'error'
const FAILED = 'failed'

/** The anchors declared beside `error`: the same part, one segment more. */
function besideOf(
  error: string,
  anchors: Readonly<Record<string, unknown>>,
): Array<[string, unknown]> {
  const part = error.slice(0, error.lastIndexOf('.') + 1)

  return entriesOf(anchors).filter(
    ([name]) => name !== error && name.startsWith(part) && !name.slice(part.length).includes('.'),
  )
}

/** The action bindings of an anchor, in their order, as `{ action, params }`. */
const actionsOf = (def: unknown) =>
  listOf(recordOf(def)['binding'])
    .filter(isRecord)
    .flatMap((ref) =>
      typeof ref['action'] === 'string'
        ? [{ action: ref['action'], params: recordOf(ref['params']) }]
        : [],
    )

/**
 * The derived codes and fields of the error `error`, before what the file writes: the actions
 * bound beside it, then those the flow invokes against it, then the codes the flow shows on it.
 */
function derivedOf(
  error: string,
  anchors: Readonly<Record<string, unknown>>,
  failureOf: FailureOf,
  sources: FlowSources,
) {
  const lists: Array<readonly string[]> = []
  const fields = new Map<string, string | null>()
  const actions = [
    ...besideOf(error, anchors).flatMap(([, def]) => actionsOf(def)),
    ...(sources.invoked.get(error) ?? []),
  ]

  for (const { action, params } of actions) {
    const failure = failureOf(action)

    lists.push(failureCodes(failure))

    for (const [param, codes] of Object.entries(
      typeof failure === 'object' ? failure.params : {},
    )) {
      const control = params[param]
      const kind = typeof control === 'string' ? recordOf(anchors[control])['kind'] : undefined

      for (const code of typeof kind === 'string' && FIELD_KINDS.has(kind) ? codes : []) {
        const known = fields.get(code)

        fields.set(code, known === undefined || known === control ? String(control) : null)
      }
    }
  }

  const codes = unionOf([...lists, sources.shown.get(error) ?? []])

  return {
    codes: codes.includes(FAILED) ? [...codes.filter((code) => code !== FAILED), FAILED] : codes,
    fields,
  }
}

function errorOf(
  error: string,
  def: Readonly<Record<string, unknown>>,
  anchors: Readonly<Record<string, unknown>>,
  failureOf: FailureOf,
  sources: FlowSources,
): Readonly<Record<string, unknown>> {
  const derived = derivedOf(error, anchors, failureOf, sources)
  const written = def['codes']
  const codes: unknown = written ?? (derived.codes.length === 0 ? undefined : derived.codes)
  const carried = new Set(Array.isArray(codes) ? codes : [])
  const fields = [...derived.fields].filter(
    (entry): entry is [string, string] => entry[1] !== null && carried.has(entry[0]),
  )

  return {
    ...def,
    ...(codes === undefined ? {} : { codes }),
    ...(def['fields'] !== undefined || fields.length === 0
      ? {}
      : { fields: Object.fromEntries(fields) }),
  }
}

/** `screen` as read, each of its error anchors with its derived codes and fields. */
export function withDerivedErrors(screen: unknown, failureOf: FailureOf): unknown {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return screen
  }

  const sources = flowSourcesOf(screen, failureOf)

  return {
    ...screen,
    anchors: Object.fromEntries(
      entriesOf(anchors).map(([name, def]) => [
        name,
        isRecord(def) && def['kind'] === ERROR
          ? errorOf(name, def, anchors, failureOf, sources)
          : def,
      ]),
    ),
  }
}
