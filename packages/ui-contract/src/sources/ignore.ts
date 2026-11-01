/**
 * The coverage-ignore markers of one source file: a comment that declares the JSX element
 * right after it not a test target, with a reason. `ui-contract-ignore: <reason>` covers
 * the element and its subtree, `ui-contract-ignore-self: <reason>` the element alone. In
 * code the marker is a line comment, `// ui-contract-ignore: <reason>`, with only white
 * space between it and the element; among JSX children it is a block comment that is the
 * only content of a JSX comment container (a block comment in braces), with only white
 * space between the closing brace and the element. The reason is the marker's own text,
 * three characters at least. The reader finds where each marker points; whether a JSX
 * element starts there, and whether it or its subtree holds a control to ignore, is for the
 * counter to say.
 */

import { type Comment, type Program, Visitor } from 'oxc-parser'

export const IGNORE_WITHOUT_REASON =
  'a ui-contract-ignore marker needs a reason of at least three characters after its colon'

export const IGNORE_WITHOUT_ELEMENT =
  'a ui-contract-ignore marker must stand right before a JSX element, with only white space between'

export const IGNORE_NO_CONTROL = 'the marker ignores no control'

export const IGNORE_MALFORMED =
  'write the marker as "// ui-contract-ignore[-self]: <reason>" before a JSX element, or as "{/* ui-contract-ignore[-self]: <reason> */}" before one among JSX children'

export interface IgnoreMarker {
  /** Where the marker's comment starts. */
  readonly at: number
  /** Where the element it applies to starts: the first character after the marker. */
  readonly target: number
  /** Only the element (`-self`), or the element and its subtree. */
  readonly self: boolean
  readonly reason: string
}

interface Span {
  readonly start: number
  readonly end: number
}

const MARKER = 'ui-contract-ignore'
const FORM = /^ui-contract-ignore(-self)?:(.*)$/s
const MINIMUM_REASON = 3

/** The offset of the first character at or after `from` that is not white space. */
function skipSpace(text: string, from: number): number {
  const rest = text.slice(from)

  return from + rest.length - rest.trimStart().length
}

/** The JSX expression containers that hold nothing but comments. */
function commentContainers(program: Program): Span[] {
  const containers: Span[] = []

  new Visitor({
    JSXExpressionContainer(node) {
      if (node.expression.type === 'JSXEmptyExpression') {
        containers.push({ start: node.start, end: node.end })
      }
    },
  }).visit(program)

  return containers
}

/** The JSX comment container whose only content is `comment`, if any. */
const containerOf = (text: string, containers: readonly Span[], comment: Comment) =>
  containers.find(
    ({ start, end }) =>
      start < comment.start &&
      comment.end < end &&
      text.slice(start + 1, end - 1).trim() === text.slice(comment.start, comment.end),
  )

/**
 * The markers of a file and the faults of the comments that start like one but cannot be
 * applied, each at the offset of its comment: a marker is a line comment in code, or a
 * block comment alone in a JSX comment container, and carries a reason of its own.
 */
export function ignoreMarkers(
  text: string,
  parsed: { readonly program: Program; readonly comments: readonly Comment[] },
): { markers: IgnoreMarker[]; faults: Array<{ at: number; message: string }> } {
  const markers: IgnoreMarker[] = []
  const faults: Array<{ at: number; message: string }> = []
  const candidates = parsed.comments.filter(({ value }) => value.trim().startsWith(MARKER))
  const containers = candidates.some(({ type }) => type === 'Block')
    ? commentContainers(parsed.program)
    : []

  for (const comment of candidates) {
    const form = FORM.exec(comment.value.trim())
    const written = comment.type === 'Block' ? containerOf(text, containers, comment) : comment

    if (form === null || written === undefined) {
      faults.push({ at: comment.start, message: IGNORE_MALFORMED })
      continue
    }

    const reason = (form[2] ?? '').replace(/\s+/g, ' ').trim()

    if (reason.length < MINIMUM_REASON) {
      faults.push({ at: comment.start, message: IGNORE_WITHOUT_REASON })
    } else {
      const target = skipSpace(text, written.end)

      markers.push({ at: comment.start, target, self: form[1] !== undefined, reason })
    }
  }

  return { markers, faults }
}
