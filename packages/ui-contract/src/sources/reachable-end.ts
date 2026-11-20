/**
 * Whether control can run off the end of a statement, read from its form alone, for the end of a
 * function body (`locals.ts`): a function whose end it can reach returns nothing there. A `return`
 * or a `throw` cannot; a block cannot when one of its statements cannot; an `if` cannot when it has
 * an `else` and neither arm can. Any other statement may, whatever it holds (a loop, a `switch`, a
 * `try`, a label, a jump, a directive), so a case the form does not rule out counts as reachable: a
 * refusal, never a silent pass.
 */

import type { Directive, FunctionBody, Statement } from 'oxc-parser'

export function endIsReachable(statement: Directive | FunctionBody | Statement): boolean {
  switch (statement.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return false
    case 'BlockStatement':
      return statement.body.every((inner) => endIsReachable(inner))
    case 'IfStatement':
      return (
        statement.alternate === null ||
        endIsReachable(statement.consequent) ||
        endIsReachable(statement.alternate)
      )
    default:
      return true
  }
}
