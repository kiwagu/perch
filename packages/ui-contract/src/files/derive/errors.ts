/**
 * The codes and fields of an error anchor, derived when the screen file leaves them out. An
 * error `<part>.error` shows what three sources give, in this order:
 *
 * - the failures of the actions the anchors beside it bind (`<part>.<name>`, in the order they
 *   are declared, each binding in its order);
 * - the failures of the actions the screen's flow invokes and shows on it, by a written
 *   `onError`, the request pattern or a region written `by` a button (`flow-errors.ts`), in the
 *   order the flow writes them;
 * - the codes the flow shows on the error explicitly, anywhere.
 *
 * So:
 *
 * - its `codes` are the codes of those sources, each once, `failed` last;
 * - its `fields` map each code that concerns a parameter (a field of the model gives, and from
 *   version 3 a platform action attributes, `failures.ts`) to the control that binding or invoke
 *   passes for the parameter, when that control is a field of the screen; a code two sources
 *   pass from two different controls is ambiguous.
 *
 * Written `codes` stay, and derived fields cover only the codes the anchor carries. Before
 * version 3 a written `fields` stays whole, replacing the derived one, and an ambiguous code
 * concerns the form. From version 3 the written entries merge over the derived ones, code by
 * code; an ambiguous code the error carries is a problem until the file writes it (a field or
 * `form`), and a written entry equal to the derived one is a problem: it is derived. A `fields`
 * written as anything but a map stays for the schema to refuse.
 */

import { FIELD_KINDS } from '../../anchors'
import { entriesOf, isRecord, listOf, recordOf } from '../../records'
import { jsonPath, type Problem } from '../problems'

import { ATTRIBUTION_EDITION, type FailureOf, failureCodes, unionOf } from './failures'
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
 * The derived codes of the error `error`, before what the file writes: the actions bound beside
 * it, then those the flow invokes against it, then the codes the flow shows on it; and per code
 * that concerns a parameter, each field passed for it.
 */
function derivedOf(
  error: string,
  anchors: Readonly<Record<string, unknown>>,
  failureOf: FailureOf,
  sources: FlowSources,
) {
  const lists: Array<readonly string[]> = []
  const fields = new Map<string, readonly string[]>()
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
        fields.set(code, unionOf([fields.get(code) ?? [], [String(control)]]))
      }
    }
  }

  const codes = unionOf([...lists, sources.shown.get(error) ?? []])

  return {
    codes: codes.includes(FAILED) ? [...codes.filter((code) => code !== FAILED), FAILED] : codes,
    fields,
  }
}

/** What an error is, as read: its anchor, its definition and where it is. */
interface ErrorAt {
  readonly file: string
  readonly error: string
  readonly def: Readonly<Record<string, unknown>>
}

/**
 * The fields of an error from version 3: the written entries over the derived ones, code by
 * code, with a problem per carried code passed from two fields and not written, and per written
 * entry equal to the derived one.
 */
function mergedOf(
  { file, error }: ErrorAt,
  written: Readonly<Record<string, unknown>>,
  derived: ReadonlyMap<string, readonly string[]>,
  carried: ReadonlySet<string>,
): { fields: Record<string, unknown>; problems: Problem[] } {
  const problems: Problem[] = []
  const single: Array<[string, string]> = []

  for (const [code, controls] of derived) {
    const [only, ...others] = controls

    if (!carried.has(code) || only === undefined) {
      continue
    }

    if (others.length === 0) {
      single.push([code, only])
    } else if (!Object.hasOwn(written, code)) {
      problems.push({
        file,
        message: `${jsonPath(['anchors', error, 'fields'])}: "${code}" is passed from two fields, ${controls.map((control) => `"${control}"`).join(' and ')}: write the one it concerns in \`fields\`, a field or \`form\``,
      })
    }
  }

  for (const [code, control] of single) {
    if (written[code] === control) {
      problems.push({
        file,
        message: `${jsonPath(['anchors', error, 'fields', code])}: "${control}" is derived: leave it out`,
      })
    }
  }

  return { fields: { ...Object.fromEntries(single), ...written }, problems }
}

function errorOf(
  at: ErrorAt,
  anchors: Readonly<Record<string, unknown>>,
  failureOf: FailureOf,
  sources: FlowSources,
  edition: number,
): { def: Readonly<Record<string, unknown>>; problems: Problem[] } {
  const { error, def } = at
  const derived = derivedOf(error, anchors, failureOf, sources)
  const written = def['codes']
  const codes: unknown = written ?? (derived.codes.length === 0 ? undefined : derived.codes)
  const carried = new Set(Array.isArray(codes) ? codes : [])
  const withCodes = { ...def, ...(codes === undefined ? {} : { codes }) }
  const writtenFields = def['fields']

  if (edition >= ATTRIBUTION_EDITION && (writtenFields === undefined || isRecord(writtenFields))) {
    const merged = mergedOf(at, writtenFields ?? {}, derived.fields, carried)

    return {
      def: {
        ...withCodes,
        ...(writtenFields === undefined && Object.keys(merged.fields).length === 0
          ? {}
          : { fields: merged.fields }),
      },
      problems: merged.problems,
    }
  }

  const fields = [...derived.fields].flatMap(
    ([code, [only, ...others]]): Array<[string, string]> =>
      only !== undefined && others.length === 0 && carried.has(code) ? [[code, only]] : [],
  )

  return {
    def: {
      ...withCodes,
      ...(writtenFields !== undefined || fields.length === 0
        ? {}
        : { fields: Object.fromEntries(fields) }),
    },
    problems: [],
  }
}

/**
 * `screen` as read, each of its error anchors with its derived codes and fields, as a contract
 * at version `edition` reads it, with the problems of its fields from version 3.
 */
export function withDerivedErrors(
  file: string,
  screen: unknown,
  failureOf: FailureOf,
  edition: number,
): { value: unknown; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return { value: screen, problems: [] }
  }

  const sources = flowSourcesOf(screen, failureOf)
  const problems: Problem[] = []
  const derived = entriesOf(anchors).map(([error, def]): [string, unknown] => {
    if (!isRecord(def) || def['kind'] !== ERROR) {
      return [error, def]
    }

    const one = errorOf({ file, error, def }, anchors, failureOf, sources, edition)

    problems.push(...one.problems)

    return [error, one.def]
  })

  return { value: { ...screen, anchors: Object.fromEntries(derived) }, problems }
}
