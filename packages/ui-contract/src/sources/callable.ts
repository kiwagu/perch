/**
 * A function a source file writes, for `alternatives.ts` to follow to what it returns where it is
 * called: an arrow, a function expression or a declaration, and a React hook that hands one on
 * (`useCallback`) or calls it (`useMemo`).
 */

import type { ArrowFunctionExpression, Expression, Function as FunctionNode } from 'oxc-parser'

import { unwrap } from './values'

export type Callable = ArrowFunctionExpression | FunctionNode

export const isCallable = (value: Expression): value is Callable =>
  value.type === 'ArrowFunctionExpression' ||
  value.type === 'FunctionExpression' ||
  value.type === 'FunctionDeclaration'

/** A hook that hands its function on (`useCallback`) or calls it (`useMemo`), if `node` is one. */
export function hooked(
  node: Expression,
): { readonly calls: boolean; readonly fn: Callable } | undefined {
  const call = unwrap(node)

  if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier') {
    return undefined
  }

  const hook = call.callee.name
  const [first] = call.arguments
  const fn = first === undefined || first.type === 'SpreadElement' ? undefined : unwrap(first)

  return (hook === 'useCallback' || hook === 'useMemo') && fn !== undefined && isCallable(fn)
    ? { calls: hook === 'useMemo', fn }
    : undefined
}
