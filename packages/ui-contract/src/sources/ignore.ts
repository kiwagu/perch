/**
 * The coverage-ignore markers of one source file: a comment that declares the JSX element
 * right after it not a test target, with a reason. `ui-contract-ignore: <reason>` covers
 * the element and its subtree, `ui-contract-ignore-self: <reason>` the element alone.
 * It is a line comment on the lines before the element, whose reason may go on over the
 * line comments that follow it, or a block comment in braces before the element among JSX
 * children. The reader finds where each marker points; whether a JSX element starts there
 * is for the counter to say.
 */

import type { Comment } from 'oxc-parser'

export const IGNORE_WITHOUT_REASON =
  'a ui-contract-ignore marker needs a reason of at least three characters'

export const IGNORE_WITHOUT_ELEMENT =
  'a ui-contract-ignore marker must stand right before a JSX element'

export const IGNORE_MALFORMED =
  'write the marker as "ui-contract-ignore: <reason>" or "ui-contract-ignore-self: <reason>"'

export interface IgnoreMarker {
  /** Where the marker's comment starts. */
  readonly at: number
  /** Where the element it applies to starts: the first character after the marker. */
  readonly target: number
  /** Only the element (`-self`), or the element and its subtree. */
  readonly self: boolean
  readonly reason: string
}

const MARKER = 'ui-contract-ignore'
const FORM = /^ui-contract-ignore(-self)?:(.*)$/s
const MINIMUM_REASON = 3

/** The offset of the first character at or after `from` that is not white space. */
function skipSpace(text: string, from: number): number {
  const rest = text.slice(from)

  return from + rest.length - rest.trimStart().length
}

const words = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The markers of a file and the faults of the comments that start like one but cannot be
 * applied, each at the offset of its comment. `comments` are the parser's, in source order.
 */
export function ignoreMarkers(
  text: string,
  comments: readonly Comment[],
): { markers: IgnoreMarker[]; faults: Array<{ at: number; message: string }> } {
  const markers: IgnoreMarker[] = []
  const faults: Array<{ at: number; message: string }> = []
  const isMarker = (comment: Comment): boolean => comment.value.trim().startsWith(MARKER)

  for (const [index, comment] of comments.entries()) {
    if (!isMarker(comment)) {
      continue
    }

    const form = FORM.exec(comment.value.trim())

    if (form === null) {
      faults.push({ at: comment.start, message: IGNORE_MALFORMED })
      continue
    }

    const parts = [form[2] ?? '']
    let end = comment.end

    for (const next of comment.type === 'Line' ? comments.slice(index + 1) : []) {
      if (next.type !== 'Line' || isMarker(next) || skipSpace(text, end) !== next.start) {
        break
      }

      parts.push(next.value)
      end = next.end
    }

    const reason = words(parts.join(' '))
    const after = skipSpace(text, end)
    const target =
      comment.type === 'Block' && text[after] === '}' ? skipSpace(text, after + 1) : after

    if (reason.length < MINIMUM_REASON) {
      faults.push({ at: comment.start, message: IGNORE_WITHOUT_REASON })
    } else {
      markers.push({ at: comment.start, target, self: form[1] !== undefined, reason })
    }
  }

  return { markers, faults }
}
