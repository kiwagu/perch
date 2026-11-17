/**
 * When an element shows, by structure: its `with` entries, each of which renders while it does,
 * and its `without` entries, none of which renders while it does. An entry is an anchor of its
 * screen, or `{ <anchor>: [codes] }`, that anchor while it shows one of these codes; whether it
 * renders is read off a page as the page helper reads it.
 */

import type { RenderedAnchor } from './page-helper'

/** An entry of `with` or `without`: an anchor, or one anchor with the codes it shows. */
export type WithEntry = string | Readonly<Record<string, readonly string[]>>

/** The anchor an entry names. */
export const entryAnchorOf = (entry: WithEntry): string =>
  typeof entry === 'string' ? entry : (Object.keys(entry)[0] ?? '')

/** The codes an entry names, undefined for a plain anchor. */
export const entryCodesOf = (entry: WithEntry): readonly string[] | undefined =>
  typeof entry === 'string' ? undefined : Object.values(entry)[0]

/** What an element says of when it shows: its `with` and `without` entries. */
export interface ShowsWith {
  readonly with?: readonly WithEntry[] | undefined
  readonly without?: readonly WithEntry[] | undefined
}

/**
 * Whether `entry` renders on a page: its anchor visible and, for a code entry, showing one of its
 * codes; undefined when the page does not say (its anchor visible, but no `data-code` read).
 */
export function entryShowsOn(
  entry: WithEntry,
  anchors: readonly RenderedAnchor[],
): boolean | undefined {
  const codes = entryCodesOf(entry)
  const visible = anchors.filter(
    ({ anchor, visible: seen }) => seen && anchor === entryAnchorOf(entry),
  )

  if (visible.length === 0 || codes === undefined) {
    return visible.length > 0
  }
  if (visible.some(({ code }) => code !== undefined && codes.includes(code))) {
    return true
  }

  return visible.every(({ code }) => code !== undefined) ? false : undefined
}

/** Whether each `with` entry of `element` renders on the page and no `without` entry does. */
export const entriesShowOn = (element: ShowsWith, anchors: readonly RenderedAnchor[]): boolean =>
  (element.with ?? []).every((entry) => entryShowsOn(entry, anchors) === true) &&
  (element.without ?? []).every((entry) => entryShowsOn(entry, anchors) === false)
