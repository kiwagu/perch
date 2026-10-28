/**
 * Where a character of a string's cooked value is written in the source: the cooked value
 * counts each escape as the characters it stands for, so its offsets drift from the source's
 * at every escape, and its line feeds are not the source's lines.
 */

/** One piece of the raw text: how long it is in the source, and how many characters it cooks to. */
interface Piece {
  readonly length: number
  readonly units: number
}

const LINE_BREAKS = new Set(['\n', ' ', ' '])

/** The escape at `at` (a backslash): `\n` cooks to one character, a line continuation to none. */
function escapeAt(source: string, at: number): Piece {
  const next = source[at + 1]

  if (next === 'x') {
    return { length: 4, units: 1 }
  }

  if (next === 'u' && source[at + 2] === '{') {
    const close = source.indexOf('}', at)

    return {
      length: close - at + 1,
      units: Number.parseInt(source.slice(at + 3, close), 16) > 0xffff ? 2 : 1,
    }
  }

  if (next === 'u') {
    return { length: 6, units: 1 }
  }

  if (next === '\r') {
    return { length: source[at + 2] === '\n' ? 3 : 2, units: 0 }
  }

  return { length: 2, units: next !== undefined && LINE_BREAKS.has(next) ? 0 : 1 }
}

/** The piece at `at`: an escape, a CR LF (a template cooks it to one line feed), or one character. */
const pieceAt = (source: string, at: number): Piece =>
  source[at] === '\\'
    ? escapeAt(source, at)
    : { length: source.startsWith('\r\n', at) ? 2 : 1, units: 1 }

/**
 * The source offset of the character `index` of a literal's cooked value, its raw text
 * starting at `start` (just after the opening quote, backtick or `}`).
 */
export function sourceOffset(source: string, start: number, index: number): number {
  let at = start
  let cooked = 0

  while (at < source.length) {
    const { length, units } = pieceAt(source, at)

    if (units > 0 && cooked + units > index) {
      return at
    }

    cooked += units
    at += length
  }

  return at
}
