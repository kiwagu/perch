/**
 * The search a flow's `navigate` effect moves with. The flow writes each value as a literal, as
 * `{ anchor: <field> }`: the value that field of the flow's own screen holds when the app moves,
 * or as `{ item: <item> }`: the id of the entry of that item whose control the user acted on.
 * The event that moves carries what its fields hold (`fields`, by anchor) and the id of the entry
 * it acted in (`items`, by item), and the view puts there only those the flow names; the contract
 * refuses a `secret` field in a navigate's search, so a password never reaches an address, the
 * browser's history or a log. A field left empty adds no key: the field it fills on the next
 * screen starts empty anyway. An item is never left out: the move is to that entry.
 */

/** What the fields named by a move hold as it happens, by anchor. */
export type FieldValues = Readonly<Record<string, string>>

/** The id of the entry a move acted in (its `data-id`), by the anchor of its item. */
export type ItemIds = Readonly<Record<string, string>>

/** A value of a navigate's search as the flow writes it. */
export type SearchValue =
  | string
  | number
  | boolean
  | { readonly anchor: string }
  | { readonly item: string }

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

/** Whether a value of a search is an entry's, `{ item }`, rather than a literal. */
const isItemValue = (value: unknown): value is { readonly item: string } =>
  isRecord(value) && typeof value['item'] === 'string'

/** Whether `value` is a search as a flow writes it: each value a literal, a field's or an item's. */
export function isSearch(value: unknown): value is Readonly<Record<string, SearchValue>> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (each) =>
        typeof each === 'string' ||
        typeof each === 'number' ||
        typeof each === 'boolean' ||
        isFieldValue(each) ||
        isItemValue(each),
    )
  )
}

/**
 * The search the app moves with: each literal as it is, each `{ anchor }` the value `fields`
 * carries for that field, left out when the field is empty, and each `{ item }` the id `items`
 * carries for that item. A field or an item the move names and its event does not carry, or an
 * item carried without an id, is a defect of the view, never guessed: it throws.
 */
export function searchOf(
  search: Readonly<Record<string, SearchValue>>,
  fields: FieldValues,
  items: ItemIds = {},
): Readonly<Record<string, SearchLiteral>> {
  return Object.fromEntries(
    Object.entries(search).flatMap(([key, value]): Array<[string, SearchLiteral]> => {
      if (isItemValue(value)) {
        const id = items[value.item]

        if (id === undefined || id === '') {
          throw new Error(
            `the move names the entry of ${value.item}, which its event does not carry`,
          )
        }

        return [[key, id]]
      }

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
