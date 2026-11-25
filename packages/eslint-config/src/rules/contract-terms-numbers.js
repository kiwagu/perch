/**
 * How the contract-terms rule finds where the code expects a number of the contract's invariants
 * (`CONTRACT_INVARIANTS`): a property, a variable's annotation or the other side of a comparison
 * whose declaration, followed through member reads, constants, destructured bindings and type
 * aliases, lies in the emitted module itself. Literal types carry no origin, so the declaration is
 * the only evidence: a number elsewhere is no number of the contract.
 */

import { resolve } from 'node:path'

import ts from 'typescript'

/** The comparisons whose other side may say a number of the contract. */
const NUMBER_COMPARISONS = new Set(['===', '!==', '==', '!=', '<', '<=', '>', '>='])

/**
 * The readers of one file, over its parser services' program, for the module at `emitted` (an
 * absolute path): `expectedNumber(node)` is the invariant and the name of the number the module
 * declares that the code expects at the number literal `node`, or undefined.
 */
export function numberReaders(services, emitted) {
  /**
   * The invariant whose number the module declares at `property`, the declaration of a property
   * the code expects: `"limit": 10` under `"failed-sign-ins"`; none for a declaration elsewhere.
   */
  function invariantDeclaring(property) {
    const declaration = (property?.getDeclarations() ?? []).find(
      (each) => resolve(each.getSourceFile().fileName) === emitted,
    )
    const holder = declaration?.parent?.parent

    return holder !== undefined &&
      ts.isPropertyAssignment(holder) &&
      ts.isStringLiteral(holder.name)
      ? holder.name.text
      : undefined
  }

  const checker = services.program.getTypeChecker()
  const tsNodeOf = (node) => services.esTreeNodeToTSNodeMap.get(node)

  /** The invariant and the name of the number the module declares as `symbol`; none elsewhere. */
  function declaredNumber(symbol) {
    const invariant = invariantDeclaring(symbol)

    return invariant === undefined ? undefined : { invariant, name: symbol.getName() }
  }

  /**
   * The number of the module a type annotation names: an indexed access into an invariant's
   * numbers, `(typeof CONTRACT_INVARIANTS)['device-limit']['limit']`, through parentheses and a
   * type alias.
   */
  function annotatedNumber(type, depth = 0) {
    if (type === undefined || depth > 4) {
      return undefined
    }

    if (ts.isParenthesizedTypeNode(type)) {
      return annotatedNumber(type.type, depth + 1)
    }

    if (
      ts.isIndexedAccessTypeNode(type) &&
      ts.isLiteralTypeNode(type.indexType) &&
      ts.isStringLiteral(type.indexType.literal)
    ) {
      const property = checker.getPropertyOfType(
        checker.getTypeFromTypeNode(type.objectType),
        type.indexType.literal.text,
      )

      return property === undefined ? undefined : declaredNumber(property)
    }

    if (ts.isTypeReferenceNode(type)) {
      const found = checker.getSymbolAtLocation(type.typeName)
      const symbol =
        found !== undefined && found.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(found)
          : found
      const alias = (symbol?.getDeclarations() ?? []).find(ts.isTypeAliasDeclaration)

      return alias === undefined ? undefined : annotatedNumber(alias.type, depth + 1)
    }

    return undefined
  }

  /**
   * The number of the module the value of the TypeScript expression `expression` comes from:
   * read as a member of it, or held by a constant or a destructured binding that reads one, or
   * by a variable annotated with one; none when it comes from anywhere else.
   */
  function derivedNumber(expression, depth = 0) {
    if (expression === undefined || depth > 6) {
      return undefined
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return derivedNumber(expression.expression, depth + 1)
    }

    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const symbol = checker.getSymbolAtLocation(
        ts.isPropertyAccessExpression(expression) ? expression.name : expression.argumentExpression,
      )

      return symbol === undefined ? undefined : declaredNumber(symbol)
    }

    if (!ts.isIdentifier(expression)) {
      return undefined
    }

    const found = checker.getSymbolAtLocation(expression)
    const symbol =
      found !== undefined && found.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(found)
        : found
    const declaration = symbol?.valueDeclaration

    if (declaration !== undefined && ts.isVariableDeclaration(declaration)) {
      const constant = (declaration.parent.flags & ts.NodeFlags.Const) !== 0

      return (
        annotatedNumber(declaration.type) ??
        (constant ? derivedNumber(declaration.initializer, depth + 1) : undefined)
      )
    }

    if (declaration !== undefined && ts.isBindingElement(declaration)) {
      const key = declaration.propertyName ?? declaration.name
      const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined
      const property =
        name === undefined
          ? undefined
          : checker.getPropertyOfType(checker.getTypeAtLocation(declaration.parent), name)

      return property === undefined ? undefined : declaredNumber(property)
    }

    return undefined
  }

  /** The number of the module the code expects at the number `node`, if it expects one. */
  function expectedNumber(node) {
    const { parent } = node

    if (parent?.type === 'BinaryExpression' && NUMBER_COMPARISONS.has(parent.operator)) {
      return derivedNumber(tsNodeOf(parent.left === node ? parent.right : parent.left))
    }

    if (parent?.type === 'VariableDeclarator' && parent.init === node) {
      return annotatedNumber(tsNodeOf(parent).type)
    }

    if (
      parent?.type !== 'Property' ||
      parent.value !== node ||
      parent.parent?.type !== 'ObjectExpression'
    ) {
      return undefined
    }

    const name =
      parent.key.type === 'Identifier' && !parent.computed
        ? parent.key.name
        : typeof parent.key.value === 'string'
          ? parent.key.value
          : undefined
    const object = checker.getContextualType(
      tsNodeOf(parent.parent),
      ts.ContextFlags.IgnoreNodeInferences,
    )

    if (name === undefined || object === undefined) {
      return undefined
    }

    for (const member of object.isUnion() ? object.types : [object]) {
      const property = checker.getPropertyOfType(member, name)
      const number = property === undefined ? undefined : declaredNumber(property)

      if (number !== undefined) {
        return number
      }
    }

    return undefined
  }

  return { expectedNumber }
}
