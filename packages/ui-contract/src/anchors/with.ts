/**
 * When an element shows, by structure: its `with` entries, each of which renders while it does,
 * and its `without` entries, none of which renders while it does. An entry is an anchor of its
 * screen, or `{ <anchor>: [codes] }`, that anchor while it shows one of these codes.
 */

/** An entry of `with` or `without`: an anchor, or one anchor with the codes it shows. */
export type WithEntry = string | Readonly<Record<string, readonly string[]>>

/** The anchor an entry names. */
export const entryAnchorOf = (entry: WithEntry): string =>
  typeof entry === 'string' ? entry : (Object.keys(entry)[0] ?? '')

/** The codes an entry names, undefined for a plain anchor. */
export const entryCodesOf = (entry: WithEntry): readonly string[] | undefined =>
  typeof entry === 'string' ? undefined : Object.values(entry)[0]
