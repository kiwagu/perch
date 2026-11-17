/**
 * Where a text names a rule of the reference: the word `rule` and the id in backticks (the rule
 * `address-key`), or a list of ids after it (the rules `a`, `b` or `c`). An id in backticks
 * anywhere else, the `roles` of a screen, names none.
 */

const NAMING = /\brules? ((?:`[a-z0-9-]+`(?:, | or | and )?)+)/g
const ID = /`([a-z0-9-]+)`/g

/** The ids of the rules `text` names, in the order it writes them, one for each time. */
export function ruleIdsNamedIn(text: string): string[] {
  return Array.from(text.matchAll(NAMING), ([, list = '']) =>
    Array.from(list.matchAll(ID), ([, id = '']) => id),
  ).flat()
}
