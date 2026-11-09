/**
 * The anchor grammar: a rendered `data-testid` is 2 to 5 dot-separated kebab-case
 * segments (a base anchor has up to 4, a derived one adds a suffix). The first one or two
 * segments name the screen, and the last dash-separated word of the last segment is the
 * anchor's kind: `user.sign-in.email-input` is screen `user.sign-in`, kind `input`.
 */

export const ANCHOR_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*){1,4}$/

export const isAnchor = (text: string): boolean => ANCHOR_PATTERN.test(text)

export const segmentsOf = (anchor: string): readonly string[] => anchor.split('.')

/** The last dash-separated word of the last segment: `email-input` is an `input`. */
export const kindOf = (anchor: string): string => {
  const last = anchor.slice(anchor.lastIndexOf('.') + 1)

  return last.slice(last.lastIndexOf('-') + 1)
}

/** The kinds a person types into or picks with: what an error's code can concern. */
export const FIELD_KINDS: ReadonlySet<string> = new Set([
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'switch',
])

/**
 * The kinds a person acts on, whose event a flow handles: a button, a link, a tab and the
 * field kinds. A cell, an entry or a container is no control, whatever it is nested in.
 */
export const CONTROL_KINDS: ReadonlySet<string> = new Set(['button', 'link', 'tab', ...FIELD_KINDS])

/** The part an anchor sits in: the anchor without its last segment. */
export const partOf = (anchor: string): string => anchor.slice(0, anchor.lastIndexOf('.'))

/** The kinds that show entries, the only ones a `source` gives entries to. */
export const LISTING_KINDS: ReadonlySet<string> = new Set(['list', 'section', 'table'])

/**
 * Whether `other` is `anchor` itself or an anchor under it (`<anchor>.<rest>`): a declared
 * anchor nested in it, such as a composite's item under its list, or a part derived from it.
 */
export const isUnder = (anchor: string, other: string): boolean =>
  other === anchor || other.startsWith(`${anchor}.`)

/** The longest screen name the anchor starts with on a segment boundary, if any. */
export const screenOf = (anchor: string, screenNames: readonly string[]): string | undefined =>
  screenNames
    .filter((name) => isUnder(name, anchor))
    .reduce<string | undefined>(
      (longest, name) => (longest === undefined || name.length > longest.length ? name : longest),
      undefined,
    )
