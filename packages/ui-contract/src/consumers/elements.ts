/**
 * Which element each attribute selector of a selector string speaks of, so that a code, a state
 * or a value pairs with the `data-testid` of its own element. Attribute selectors written one
 * after another are of one element. A `:not(`, `:is(` or `:where(` whose argument is one compound
 * speaks of that same element: what it holds pairs with the element's anchor, and a `data-testid`
 * in it names the element, except under a `:not(`, which says what the element is not. Any other
 * parenthesised argument (a `:has(`, a pseudo-class such as `:nth-child(`, or a `:not(` holding a
 * combinator or a list) speaks of elements of its own, which pair among themselves; after its `)`
 * the element written before it goes on. Anything else (a space, `>`, `+`, `~`, `,`, an
 * expression, other text) may lead to another element.
 */

/** An attribute selector of a string: what it names, and where it starts and ends in the string. */
export interface SelectorMatch {
  /** `anchor` for a `data-testid` selector. */
  readonly kind: string | undefined
  readonly value: string | undefined
  readonly at: number
  readonly end: number
}

/** What decides which element a selector is of; the rest of the string is passed over. */
type Token =
  | { readonly type: 'selector'; readonly index: number }
  | { readonly type: 'open'; readonly pseudo: string | undefined }
  | { readonly type: 'close' }
  | { readonly type: 'break' }

/** Passed over inside one element: another attribute selector, or a quoted string. */
const NEUTRAL = /\[[^\]\0]*\]|"[^"\0]*"|'[^'\0]*'/y

/** The opening of a functional pseudo-class's argument, or a bare parenthesis. */
const OPEN = /(?::([\w-]+))?\(/y

/** The pseudo-classes whose argument is matched against the element they are written on. */
const SAME_ELEMENT = new Set(['not', 'is', 'where'])

const NEGATION = 'not'

/** The text `pattern` (sticky) matches at `at` in `text`, if any. */
function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at

  return pattern.exec(text)
}

function tokensOf(joined: string, matches: readonly SelectorMatch[]): Token[] {
  const starts = new Map(matches.map(({ at }, index) => [at, index]))
  const tokens: Token[] = []
  let at = 0

  while (at < joined.length) {
    const index = starts.get(at)
    const open = index === undefined ? matchAt(OPEN, joined, at) : null
    const neutral = index === undefined && open === null ? matchAt(NEUTRAL, joined, at) : null

    if (index !== undefined) {
      tokens.push({ type: 'selector', index })
      at = matches[index]?.end ?? at + 1
    } else if (open !== null) {
      tokens.push({ type: 'open', pseudo: open[1] })
      at += open[0].length
    } else if (neutral !== null) {
      at += neutral[0].length
    } else {
      if (joined[at] === ')') {
        tokens.push({ type: 'close' })
      } else if (tokens.at(-1)?.type !== 'break') {
        tokens.push({ type: 'break' })
      }

      at += 1
    }
  }

  return tokens
}

/** Whether the argument opened at `tokens[from]` is one compound: no break outside a nested one. */
function oneCompound(tokens: readonly Token[], from: number): boolean {
  let depth = 0

  for (const token of tokens.slice(from + 1)) {
    if (token.type === 'open') {
      depth += 1
    } else if (token.type === 'close') {
      if (depth === 0) {
        return true
      }

      depth -= 1
    } else if (token.type === 'break' && depth === 0) {
      return false
    }
  }

  return false
}

/** The element a selector is of, and whether a `data-testid` there names that element. */
interface Place {
  readonly element: number
  readonly names: boolean
}

/** The place of each selector of `joined`, by its index in `matches`. */
function placesOf(joined: string, matches: readonly SelectorMatch[]): Array<Place | undefined> {
  const tokens = tokensOf(joined, matches)
  const places: Array<Place | undefined> = matches.map(() => undefined)
  const stack: Array<{ element: number; readonly names: boolean }> = [{ element: 0, names: true }]
  let elements = 1

  tokens.forEach((token, position) => {
    const frame = stack.at(-1) ?? { element: 0, names: true }

    if (token.type === 'selector') {
      places[token.index] = { element: frame.element, names: frame.names }
    } else if (token.type === 'open') {
      const same = SAME_ELEMENT.has(token.pseudo ?? '') && oneCompound(tokens, position)

      stack.push(
        same
          ? { element: frame.element, names: frame.names && token.pseudo !== NEGATION }
          : { element: elements++, names: true },
      )
    } else if (token.type === 'close' && stack.length > 1) {
      stack.pop()
    } else {
      frame.element = elements++
    }
  })

  return places
}

/**
 * For each selector of `joined`, the anchor of the element it selects when a `data-testid`
 * selector naming that element is written: the nearest before it, else the nearest after it.
 */
export function elementAnchors(
  joined: string,
  matches: readonly SelectorMatch[],
): Array<string | undefined> {
  const places = placesOf(joined, matches)
  const testIds = matches.flatMap(({ kind, value }, index) => {
    const place = places[index]

    return kind === 'anchor' && place?.names === true
      ? [{ index, element: place.element, value }]
      : []
  })

  return matches.map((_, index) => {
    const element = places[index]?.element
    const ofElement = testIds.filter((testId) => testId.element === element)
    const before = ofElement.filter((testId) => testId.index < index).at(-1)

    return (before ?? ofElement.find((testId) => testId.index > index))?.value
  })
}
