/**
 * The params of a form's submit button, derived from its fields: a `button` whose binding
 * names an action gets, for that action, the union of the params the fields of its part
 * (`<part>.<name>`, one segment more, of a field kind) pass in their own bindings of that
 * action; a param the button writes wins over the derived one, key by key, so a value no field
 * passes (a constant, a search parameter, an anchor of the frame) stays written. Two fields
 * passing one param with different values is a problem of the button, which then writes that
 * param. `controlsOf` and the error derivation read the result, so an invoke's input and an
 * error's fields see what a written button gives them.
 */

import { FIELD_KINDS } from '../../anchors'
import { entriesOf, isRecord, listOf, recordOf, sameValue } from '../../records'
import { jsonPath, type Problem } from '../problems'

const BUTTON = 'button'

/** The part an anchor sits in: the anchor without its last segment. */
export const partOf = (anchor: string): string => anchor.slice(0, anchor.lastIndexOf('.'))

/** The fields declared in `part`: `<part>.<name>`, one segment more, of a field kind. */
function fieldsOf(
  part: string,
  anchors: Readonly<Record<string, unknown>>,
): Array<[string, unknown]> {
  const prefix = `${part}.`

  return entriesOf(anchors).filter(([name, def]) => {
    const kind = recordOf(def)['kind']

    return (
      name.startsWith(prefix) &&
      !name.slice(prefix.length).includes('.') &&
      typeof kind === 'string' &&
      FIELD_KINDS.has(kind)
    )
  })
}

/**
 * Per param of `action`, the value the fields pass; a param two fields pass with different
 * values is left out and listed among the conflicts with the fields that pass it.
 */
function passedBy(
  action: string,
  fields: ReadonlyArray<[string, unknown]>,
): { params: Record<string, unknown>; conflicts: Map<string, string[]> } {
  const values = new Map<string, unknown>()
  const passers = new Map<string, string[]>()

  for (const [field, def] of fields) {
    for (const ref of listOf(recordOf(def)['binding']).filter(isRecord)) {
      if (ref['action'] !== action) {
        continue
      }

      for (const [param, value] of entriesOf(ref['params'])) {
        const by = passers.get(param)

        if (by === undefined) {
          values.set(param, value)
          passers.set(param, [field])
        } else if (!sameValue(values.get(param), value)) {
          by.push(field)
        }
      }
    }
  }

  const conflicts = new Map([...passers].filter(([, by]) => by.length > 1))

  return {
    params: Object.fromEntries([...values].filter(([param]) => !conflicts.has(param))),
    conflicts,
  }
}

/** `screen` as read, each button's action bindings with the params its part's fields pass. */
export function withDerivedParams(
  file: string,
  screen: unknown,
): { value: unknown; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return { value: screen, problems: [] }
  }

  const problems: Problem[] = []
  const derived = entriesOf(anchors).map(([anchor, def]): [string, unknown] => {
    if (!isRecord(def) || def['kind'] !== BUTTON || def['binding'] === undefined) {
      return [anchor, def]
    }

    const fields = fieldsOf(partOf(anchor), anchors)
    const listed = Array.isArray(def['binding'])
    const refs = listOf(def['binding']).map((ref, index) => {
      const action = isRecord(ref) ? ref['action'] : undefined

      // Params written as anything but a record stay for the canonical schema to refuse.
      if (
        !isRecord(ref) ||
        typeof action !== 'string' ||
        (ref['params'] !== undefined && !isRecord(ref['params']))
      ) {
        return ref
      }

      const written = recordOf(ref['params'])
      const { params, conflicts } = passedBy(action, fields)
      const at = ['anchors', anchor, 'binding', ...(listed ? [index] : []), 'params']

      for (const [param, by] of conflicts) {
        if (!Object.hasOwn(written, param)) {
          problems.push({
            file,
            message: `${jsonPath([...at, param])}: both ${by.join(' and ')} pass it to ${action}: write the button's params`,
          })
        }
      }

      const merged = { ...params, ...written }

      return Object.keys(merged).length === 0 ? ref : { ...ref, params: merged }
    })

    return [anchor, { ...def, binding: listed ? refs : refs[0] }]
  })

  return { value: { ...screen, anchors: Object.fromEntries(derived) }, problems }
}
