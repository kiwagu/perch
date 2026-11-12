/**
 * The entry a control acts for. A navigate's `{ item: <item> }` search value is the `data-id` of
 * the entry of that `item` (or `row`) whose control the user acted on: the app reads it off the
 * page with `itemIdOf`, so the id that reaches the address is the attribute a test reads, never one
 * the view passes beside it.
 */

import { ANCHOR_ATTRIBUTES } from './page-helper'

/** What `itemIdOf` reads of a control: the closest element a selector matches (a DOM `Element`). */
export interface InEntry {
  closest(selector: string): { getAttribute(name: string): string | null } | null
}

/**
 * The `data-id` of the entry of `item` that `control` is in: the closest element whose anchor is
 * `item`. A control outside such an entry, or an entry without an id, is a defect of the view,
 * never guessed: it throws.
 */
export function itemIdOf(control: InEntry, item: string): string {
  const entry = control.closest(`[${ANCHOR_ATTRIBUTES.anchor}="${item}"]`)

  if (entry === null) {
    throw new Error(`the control is in no entry of ${item}`)
  }

  const id = entry.getAttribute(ANCHOR_ATTRIBUTES.id)

  if (id === null || id === '') {
    throw new Error(`the entry of ${item} the control is in carries no id`)
  }

  return id
}
