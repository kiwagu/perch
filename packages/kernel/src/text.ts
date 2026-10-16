const collators = new Map<string, Intl.Collator>()

function collatorFor(locale: string): Intl.Collator {
  const cached = collators.get(locale)

  if (cached) {
    return cached
  }

  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })

  collators.set(locale, collator)

  return collator
}

/** The one text comparison of the workspace: case- and accent-insensitive, numbers ordered naturally. */
export function compareText(left: string, right: string, locale = 'en'): number {
  return collatorFor(locale).compare(left, right)
}

/** A comparator over records, ordering them by one text field. */
export function byText<T>(
  select: (item: T) => string,
  locale = 'en',
): (left: T, right: T) => number {
  return (left, right) => compareText(select(left), select(right), locale)
}
