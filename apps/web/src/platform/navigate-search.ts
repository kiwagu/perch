/**
 * The search a flow's `navigate` effect moves with. The flow writes each value as a literal, or as
 * `{ anchor: <field> }`: the value that field of the flow's own screen holds when the app moves.
 * The event that moves it carries what its fields hold (`fields`, by anchor), and the view puts
 * there only the fields the flow names; the contract refuses a `secret` field in a navigate's
 * search, so a password never reaches an address, the browser's history or a log. A field left
 * empty adds no key: the field it fills on the next screen starts empty anyway.
 */

/** What the fields named by a move hold as it happens, by anchor. */
export type FieldValues = Readonly<Record<string, string>>

/** A value of a navigate's search as the flow writes it. */
export type SearchValue = string | number | boolean | { readonly anchor: string }

/** A flow's `navigate` effect: where to go, with its search when it gives one. */
export interface NavigateParams {
  readonly to: string
  readonly search?: Readonly<Record<string, SearchValue>>
}

/** A value the address takes as it is. */
export type SearchLiteral = string | number | boolean

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** Whether a value of a search is a field's, `{ anchor }`, rather than a literal. */
const isFieldValue = (value: unknown): value is { readonly anchor: string } =>
  isRecord(value) && typeof value['anchor'] === 'string'

/** Whether `value` is a search as a flow writes it: each value a literal or a field's. */
export function isSearch(value: unknown): value is Readonly<Record<string, SearchValue>> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (each) =>
        typeof each === 'string' ||
        typeof each === 'number' ||
        typeof each === 'boolean' ||
        isFieldValue(each),
    )
  )
}

/**
 * The search the app moves with: each literal as it is, each `{ anchor }` the value `fields`
 * carries for that field, left out when the field is empty. A field the move names and its event
 * does not carry is a defect of the view, never guessed: it throws.
 */
export function searchOf(
  search: Readonly<Record<string, SearchValue>>,
  fields: FieldValues,
): Readonly<Record<string, SearchLiteral>> {
  return Object.fromEntries(
    Object.entries(search).flatMap(([key, value]): Array<[string, SearchLiteral]> => {
      if (!isFieldValue(value)) {
        return [[key, value]]
      }

      const held = fields[value.anchor]

      if (held === undefined) {
        throw new Error(`the move names the field ${value.anchor}, which its event does not carry`)
      }

      return held === '' ? [] : [[key, held]]
    }),
  )
}
