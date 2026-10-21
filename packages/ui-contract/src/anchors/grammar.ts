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

/** The longest screen name the anchor starts with on a segment boundary, if any. */
export const screenOf = (anchor: string, screenNames: readonly string[]): string | undefined =>
  screenNames
    .filter((name) => anchor === name || anchor.startsWith(`${name}.`))
    .reduce<string | undefined>(
      (longest, name) => (longest === undefined || name.length > longest.length ? name : longest),
      undefined,
    )
