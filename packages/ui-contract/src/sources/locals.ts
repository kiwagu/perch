/**
 * What a source file's names stand for, as far as the file itself says: the value a constant is
 * declared with, read in the scope that declares it, so a name a view writes resolves as it does
 * at runtime (an inner declaration, a parameter or a destructured name hides an outer one). The
 * collector follows a `<NAME>_TEST_ID` constant to the anchor it holds; a name declared in another
 * file, or a value built at runtime, resolves to nothing.
 */

import type {
  BindingPattern,
  BindingRestElement,
  Expression,
  JSXAttributeValue,
  ParamPattern,
  Program,
} from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { testIdFor } from '../anchors'

import {
  type CarriedAnchor,
  derivedAnchorOf,
  isTestIdFor,
  staticText,
  TEST_ID_CONSTANT,
  unwrap,
} from './values'

/** A range of the source, `[start, end)`. */
interface Span {
  readonly start: number
  readonly end: number
}

/** A name a scope binds, with the value the file declares it with; none for a parameter. */
interface Binding {
  readonly name: string
  /** Where it is declared; its scope is the innermost scope around this place. */
  readonly at: Span
  readonly value?: Expression
}

export interface Locals {
  /** What `name`, written at `at`, is declared with in the file, if the file says. */
  valueOf(name: string, at: number): Expression | undefined
}

const FILE: Span = { start: 0, end: Number.POSITIVE_INFINITY }

const contains = (outer: Span, inner: Span): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

const sizeOf = ({ start, end }: Span): number => end - start

/** The names a binding pattern binds: `a`, `{ a, b: c }` binds `a` and `c`, `[a, ...b]` both. */
function namesIn(pattern: BindingPattern | ParamPattern | BindingRestElement): string[] {
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name]
    case 'AssignmentPattern':
      return namesIn(pattern.left)
    case 'RestElement':
      return namesIn(pattern.argument)
    case 'ObjectPattern':
      return pattern.properties.flatMap((property) =>
        namesIn(property.type === 'RestElement' ? property : property.value),
      )
    case 'ArrayPattern':
      return pattern.elements.flatMap((element) => (element === null ? [] : namesIn(element)))
    case 'TSParameterProperty':
      return namesIn(pattern.parameter)
    default:
      return []
  }
}

export function localsOf(program: Program): Locals {
  const scopes: Span[] = [FILE]
  const bindings: Binding[] = []
  const parameters = (node: Span & { readonly params: readonly ParamPattern[] }): void => {
    scopes.push(node)
    bindings.push(
      ...node.params
        .flatMap(namesIn)
        .map((name) => ({ name, at: { start: node.start, end: node.start } })),
    )
  }

  new Visitor({
    BlockStatement: (node) => {
      scopes.push(node)
    },
    ArrowFunctionExpression: parameters,
    FunctionExpression: parameters,
    FunctionDeclaration: parameters,
    VariableDeclarator: (node) => {
      const at = { start: node.start, end: node.end }

      if (node.id.type === 'Identifier') {
        bindings.push({
          name: node.id.name,
          at,
          ...(node.init === null ? {} : { value: node.init }),
        })
      } else {
        bindings.push(...namesIn(node.id).map((name) => ({ name, at })))
      }
    },
  }).visit(program)

  /** The innermost scope around a place, a parameter's being its function. */
  const scopeOf = (at: Span): Span =>
    scopes
      .filter((scope) => contains(scope, at))
      .reduce((inner, scope) => (sizeOf(scope) < sizeOf(inner) ? scope : inner), FILE)

  const scoped = bindings.map((binding) => ({ ...binding, scope: scopeOf(binding.at) }))

  return {
    valueOf(name, at) {
      const seen = scoped
        .filter(
          (binding) => binding.name === name && contains(binding.scope, { start: at, end: at }),
        )
        .reduce<(typeof scoped)[number] | undefined>(
          (inner, binding) =>
            inner === undefined || sizeOf(binding.scope) < sizeOf(inner.scope) ? binding : inner,
          undefined,
        )

      return seen?.value
    },
  }
}

/**
 * The anchor an attribute carries through a `<NAME>_TEST_ID` constant of its file: the constant's
 * literal, or `testIdFor()` of such a constant and a literal suffix, which comes with its base; no
 * anchor for any other value, a constant the file does not declare as a literal included.
 */
export function constantAnchorOf(
  locals: Locals,
  value: JSXAttributeValue | null,
  at: number,
): CarriedAnchor | undefined {
  if (value?.type !== 'JSXExpressionContainer' || value.expression.type === 'JSXEmptyExpression') {
    return undefined
  }

  const constant = (node: Expression | undefined): string | undefined => {
    const name = node === undefined ? undefined : unwrap(node)

    if (name?.type !== 'Identifier' || !TEST_ID_CONSTANT.test(name.name)) {
      return undefined
    }

    return staticText(locals.valueOf(name.name, at))
  }
  const written = unwrap(value.expression)
  const held = constant(written)

  if (held !== undefined) {
    return { anchor: held }
  }

  if (written.type === 'Identifier' && TEST_ID_CONSTANT.test(written.name)) {
    const declared = locals.valueOf(written.name, at)

    return declared === undefined ? undefined : derivedAnchorOf(declared)
  }

  if (written.type !== 'CallExpression' || !isTestIdFor(written.callee)) {
    return undefined
  }

  const [base, suffix] = written.arguments
  const from = base === undefined || base.type === 'SpreadElement' ? undefined : constant(base)
  const part = staticText(suffix)

  return from === undefined || part === undefined
    ? undefined
    : { anchor: testIdFor(from, part), base: from }
}
