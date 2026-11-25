/**
 * How the contract-terms rule finds where the code expects a number of the contract's invariants
 * (`CONTRACT_INVARIANTS`): a property, a variable's annotation, an argument's parameter or the
 * other side of a comparison whose declaration, followed through member reads, constants,
 * parameters, destructured bindings, type queries (`typeof DEVICE_LIMIT`), type aliases, imports
 * and re-exports, lies in the emitted module itself; the literal is read through an `as`, a
 * `satisfies` or a `!` around it. Literal types carry no origin, so the declaration is
 * the only evidence: a number elsewhere is no number of the contract.
 */

import { resolve } from 'node:path'

import ts from 'typescript'

/** The generic array types whose one type argument is every element's. */
const ARRAYS = new Set(['Array', 'ReadonlyArray'])

/** How many declarations a value is followed through before the readers give up. */
const MAX_HOPS = 16

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
   * The number of the module `symbol` is or holds: a number the module declares, a constant whose
   * initializer reads one, a variable or a parameter annotated with one, a destructured binding of
   * one; an alias (an import, a re-export) by what it names.
   */
  function symbolNumber(found, depth) {
    if (found === undefined || depth > MAX_HOPS) {
      return undefined
    }

    const symbol = found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found
    const direct = declaredNumber(symbol)

    if (direct !== undefined) {
      return direct
    }

    const declaration = symbol.valueDeclaration

    if (declaration === undefined) {
      return undefined
    }

    if (ts.isVariableDeclaration(declaration)) {
      const constant = (declaration.parent.flags & ts.NodeFlags.Const) !== 0

      return (
        annotatedNumber(declaration.type, depth + 1) ??
        (constant ? derivedNumber(declaration.initializer, depth + 1) : undefined)
      )
    }

    if (ts.isParameter(declaration)) {
      return annotatedNumber(declaration.type, depth + 1)
    }

    if (ts.isBindingElement(declaration)) {
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

  /**
   * The number of the module a type annotation names: an indexed access into an invariant's
   * numbers, `(typeof CONTRACT_INVARIANTS)['device-limit']['limit']`, a type query of a value that
   * holds one (`typeof DEVICE_LIMIT`), through parentheses and a type alias.
   */
  function annotatedNumber(type, depth = 0) {
    if (type === undefined || depth > MAX_HOPS) {
      return undefined
    }

    if (ts.isParenthesizedTypeNode(type)) {
      return annotatedNumber(type.type, depth)
    }

    if (ts.isTypeQueryNode(type)) {
      return symbolNumber(checker.getSymbolAtLocation(type.exprName), depth + 1)
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
   * The number of the module the value of the TypeScript expression `expression` comes from: read
   * as a member of it, or held by what an identifier names (`symbolNumber`); none when it comes from
   * anywhere else.
   */
  function derivedNumber(expression, depth = 0) {
    if (expression === undefined || depth > MAX_HOPS) {
      return undefined
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return derivedNumber(expression.expression, depth)
    }

    if (ts.isPropertyAccessExpression(expression)) {
      return symbolNumber(checker.getSymbolAtLocation(expression.name), depth)
    }

    // A computed index names the member it selects only when it is a literal; the value of any
    // other index (`counts[DEVICE_LIMIT]`) is that of an entry, not of the index.
    if (ts.isElementAccessExpression(expression)) {
      const key = expression.argumentExpression

      return ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)
        ? symbolNumber(
            checker.getPropertyOfType(checker.getTypeAtLocation(expression.expression), key.text),
            depth,
          )
        : undefined
    }

    return ts.isIdentifier(expression)
      ? symbolNumber(checker.getSymbolAtLocation(expression), depth)
      : undefined
  }

  /** The node a number literal stands as: itself, or the `as`, `satisfies` or `!` around it. */
  function standing(node) {
    let at = node

    while (
      (at.parent?.type === 'TSAsExpression' ||
        at.parent?.type === 'TSSatisfiesExpression' ||
        at.parent?.type === 'TSNonNullExpression') &&
      at.parent.expression === at
    ) {
      at = at.parent
    }

    return at
  }

  /**
   * The number of the module the parameter a call or a `new` passes `argument` to is annotated
   * with: an explicit `this` parameter takes no argument, and an argument a rest parameter takes is
   * held to its element (`...ns: (typeof DEVICE_LIMIT)[]`).
   */
  function parameterNumber(call, argument) {
    const index = call.arguments.indexOf(argument)
    const signature = checker.getResolvedSignature(tsNodeOf(call))
    const parameters = (signature?.getDeclaration()?.parameters ?? []).filter(
      (parameter) => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'),
    )
    const rest = parameters.at(-1)?.dotDotDotToken === undefined ? undefined : parameters.at(-1)
    const parameter =
      index >= parameters.length - 1 && rest !== undefined ? rest : parameters[index]

    if (index === -1 || parameter === undefined) {
      return undefined
    }

    if (parameter !== rest) {
      return annotatedNumber(parameter.type)
    }

    return annotatedNumber(elementOf(parameter.type))
  }

  /**
   * The element type of a homogeneous array type, `T[]`, `readonly T[]`, `Array<T>` or
   * `ReadonlyArray<T>`; none for any other type, a tuple or a generic of one argument among them,
   * whose slots need not share one type.
   */
  function elementOf(type) {
    if (type === undefined) {
      return undefined
    }

    if (
      ts.isParenthesizedTypeNode(type) ||
      (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword)
    ) {
      return elementOf(type.type)
    }

    if (ts.isArrayTypeNode(type)) {
      return type.elementType
    }

    return ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName) &&
      ARRAYS.has(type.typeName.text) &&
      type.typeArguments?.length === 1
      ? type.typeArguments[0]
      : undefined
  }

  /**
   * The number of the module the code expects at the number `literal`, if it expects one, the
   * literal read through an `as`, a `satisfies` or a `!` around it.
   */
  function expectedNumber(literal) {
    const node = standing(literal)
    const { parent } = node

    if (parent?.type === 'BinaryExpression' && NUMBER_COMPARISONS.has(parent.operator)) {
      return derivedNumber(tsNodeOf(parent.left === node ? parent.right : parent.left))
    }

    if (parent?.type === 'VariableDeclarator' && parent.init === node) {
      return annotatedNumber(tsNodeOf(parent).type)
    }

    if (
      (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') &&
      parent.callee !== node
    ) {
      return parameterNumber(parent, node)
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
