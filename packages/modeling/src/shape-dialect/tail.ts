import { ModelingException } from '../errors'
import { isKeyword, isPunct, type Token } from '../tokenizer'

import { ARROWS, type PathStep, type TailPath } from './ast'

/** Words of a tail that are clause keywords, operators or literals rather than fields. */
const TAIL_WORDS = new Set([
  'WHERE',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'COLLATE',
  'NUMERIC',
  'RAND',
  'LIMIT',
  'START',
  'AT',
  'FETCH',
  'AND',
  'OR',
  'NOT',
  'IS',
  'IN',
  'CONTAINS',
  'CONTAINSNOT',
  'CONTAINSALL',
  'CONTAINSANY',
  'CONTAINSNONE',
  'INSIDE',
  'NOTINSIDE',
  'ALLINSIDE',
  'ANYINSIDE',
  'NONEINSIDE',
  'OUTSIDE',
  'INTERSECTS',
  'NONE',
  'NULL',
  'TRUE',
  'FALSE',
])

/** The field paths a tail reads; refuses forms whose reads cannot be determined. */
export function parseTail(tokens: readonly Token[]): TailPath[] {
  const paths: TailPath[] = []
  let index = 0
  let fetching = false

  const followDots = (): PathStep[] => {
    const steps: PathStep[] = []

    while (isPunct(tokens[index], '.') && tokens[index + 1]?.kind === 'word') {
      steps.push({ kind: 'field', name: tokens[index + 1]?.text ?? '' })
      index += 2
    }

    return steps
  }

  while (index < tokens.length) {
    const token = tokens[index]

    if (!token) {
      break
    }

    // FETCH is the last clause: every word after it is a field, `in` included.
    if (isKeyword(token, 'FETCH')) {
      fetching = true
      index += 1
      continue
    }

    if (isKeyword(token, 'SELECT')) {
      throw new ModelingException(
        'subqueries are not allowed in a shape; read the other table in the projection or a DEFINE FUNCTION',
      )
    }

    if (token.kind === 'punct' && token.text in ARROWS) {
      throw new ModelingException(
        'graph traversals belong in the projection of a shape, not in its WHERE, ORDER BY or FETCH',
      )
    }

    if (token.kind === 'word' && isPunct(tokens[index + 1], '(')) {
      // Built-in functions (`string::lowercase`, `count`) read no table; a custom
      // function may read any.
      if (token.text.toLowerCase().startsWith('fn::')) {
        throw new ModelingException(
          `a custom function such as ${token.text} may read any table; keep it out of a shape's tail`,
        )
      }

      index += 1
      continue
    }

    if (token.kind === 'param') {
      index += 1

      const steps = followDots()

      if (steps.length > 0) {
        paths.push({ param: token.text, steps, ...(fetching ? { fetch: true } : {}) })
      }

      continue
    }

    // `in` and `out` are operators and also the fields of a relation: a word
    // followed by a dot is always a field path.
    const fieldLike =
      fetching || !TAIL_WORDS.has(token.text.toUpperCase()) || isPunct(tokens[index + 1], '.')

    if (token.kind === 'word' && fieldLike) {
      index += 1
      paths.push({
        steps: [{ kind: 'field', name: token.text }, ...followDots()],
        ...(fetching ? { fetch: true } : {}),
      })
      continue
    }

    index += 1
  }

  return paths
}
