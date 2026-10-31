/**
 * The bracket references of a scenario's text: `[<anchor>]`, `[/path]`, `[code:<code>]`,
 * `[state:<state>]`, `[value:<value>]` and `[mail:<action>]`. Anything else in brackets is a
 * problem; whether a reference names something the contract declares is the contract check's
 * business.
 */

import { isAnchor } from '../anchors'

export type Reference = {
  kind: 'anchor' | 'route' | 'code' | 'state' | 'value' | 'mail'
  value: string
  raw: string
}

const GROUP = /\[([^\]]*)\]/g
const PREFIXED = /^(code|state|value|mail):(.+)$/

function referenceOf(inner: string, raw: string): Reference | undefined {
  if (inner.startsWith('/')) {
    return { kind: 'route', value: inner, raw }
  }

  const prefixed = PREFIXED.exec(inner)

  if (
    prefixed?.[1] === 'code' ||
    prefixed?.[1] === 'state' ||
    prefixed?.[1] === 'value' ||
    prefixed?.[1] === 'mail'
  ) {
    return { kind: prefixed[1], value: prefixed[2] ?? '', raw }
  }

  return isAnchor(inner) ? { kind: 'anchor', value: inner, raw } : undefined
}

export function referencesIn(text: string): { references: Reference[]; problems: string[] } {
  const references: Reference[] = []
  const problems: string[] = []

  for (const [raw, inner = ''] of text.matchAll(GROUP)) {
    const reference = referenceOf(inner, raw)

    if (reference) {
      references.push(reference)
    } else {
      problems.push(`not an anchor, a route, a code, a state, a value or a mail: "${inner}"`)
    }
  }

  return { references, problems }
}
