/**
 * How the contract-terms rule reads TypeScript's types: the string values the code admits where a
 * string stands (the type it declares there, never one inferred from the string or narrowed by
 * the flow; the declared side of a comparison or a switch; a property's values across the members
 * of its object's union), and the keys a map is expected to have when they come from a union of
 * keys. A value set is closed only when it is made of string literals.
 */

import ts from 'typescript'

const COMPARISONS = new Set(['===', '!==', '==', '!='])

/**
 * The string values a type admits, when it admits nothing but string literals; none otherwise. A
 * type parameter is read by its constraint, and `undefined` and `null` are set aside.
 */
function closedValues(type, checker) {
  const read =
    type.flags & ts.TypeFlags.TypeParameter ? checker.getBaseConstraintOfType(type) : type

  if (read === undefined) {
    return undefined
  }

  const values = []

  for (const part of read.isUnion() ? read.types : [read]) {
    if (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) {
      continue
    }

    if (!part.isStringLiteral()) {
      return undefined
    }

    values.push(part.value)
  }

  return values.length > 0 ? values : undefined
}

/** Whether the property comes from a union of keys, with no field declared for it. */
const fromKeyUnion = (property) =>
  (property.getDeclarations() ?? []).every(
    (declaration) =>
      !ts.isPropertySignature(declaration) &&
      !ts.isPropertyDeclaration(declaration) &&
      !ts.isPropertyAssignment(declaration) &&
      !ts.isShorthandPropertyAssignment(declaration),
  )

/** The expression under `?.` and `!`: `target?.kind` reads `target.kind`, `target!` `target`. */
const unwrapped = (node) =>
  node.type === 'ChainExpression' || node.type === 'TSNonNullExpression'
    ? unwrapped(node.expression)
    : node

/** The readers of the types of one file, over its parser services' program. */
export function typeReaders(services) {
  const checker = services.program.getTypeChecker()
  const tsNodeOf = (node) => services.esTreeNodeToTSNodeMap.get(node)

  /**
   * The string values the property `name` admits across the members of `type`: a member that is
   * `undefined` or `null`, or that has no such property and no string index, adds none; one whose
   * index holds the values says them; a member that admits any string makes the whole open.
   */
  function propertyValues(type, name) {
    const values = (type.isUnion() ? type.types : [type]).map((member) => {
      if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) {
        return []
      }

      const field = checker.getPropertyOfType(member, name)

      if (field !== undefined) {
        return closedValues(checker.getTypeOfSymbol(field), checker)
      }

      // No property of that name: the index signatures that take the name say what it holds.
      const applicable = checker
        .getIndexInfosOfType(member)
        .filter(({ keyType }) => indexTakes(keyType, name))
        .map(({ type: held }) => held)
        .filter((held) => !(held.flags & ts.TypeFlags.Never))
      const read = applicable.map((held) => closedValues(held, checker))

      return read.some((each) => each === undefined) ? undefined : read.flat()
    })

    return values.some((each) => each === undefined) ? undefined : values.flat()
  }

  /** Whether an index whose keys are `keyType` takes the property name `name`. */
  function indexTakes(keyType, name) {
    if (checker.isTypeAssignableTo(checker.getStringLiteralType(name), keyType)) {
      return true
    }

    const number = Number(name)

    return (
      name !== '' &&
      String(number) === name &&
      checker.isTypeAssignableTo(checker.getNumberLiteralType(number), keyType)
    )
  }

  /** The name of the property `a.b`, `a['b']` or ``a[`b`]`` reads, when it is written out. */
  function propertyNameOf(node) {
    if (!node.computed && node.property.type === 'Identifier') {
      return node.property.name
    }

    if (!node.computed) {
      return undefined
    }

    if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
      return node.property.value
    }

    return node.property.type === 'TemplateLiteral' && node.property.expressions.length === 0
      ? (node.property.quasis[0]?.value.cooked ?? undefined)
      : undefined
  }

  /** The type the identifier `node` is declared with, or its type here when it has no symbol. */
  function declaredTypeOfIdentifier(node) {
    const found = checker.getSymbolAtLocation(tsNodeOf(node))
    const symbol =
      found !== undefined && found.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(found)
        : found

    return symbol === undefined
      ? checker.getTypeAtLocation(tsNodeOf(node))
      : checker.getTypeOfSymbol(symbol)
  }

  /**
   * The string values the expression `node` admits as declared, never as the flow narrowed it
   * where it stands: a variable by the type of its declaration, a property by its type across
   * every member of its object's declared union (through `?.` and `!` alike); any other
   * expression by its type.
   */
  function declaredValuesOf(node) {
    if (node !== unwrapped(node)) {
      return declaredValuesOf(unwrapped(node))
    }

    if (node.type === 'Identifier') {
      return closedValues(declaredTypeOfIdentifier(node), checker)
    }

    const property = node.type === 'MemberExpression' ? propertyNameOf(node) : undefined

    if (property !== undefined) {
      const object = unwrapped(node.object)
      const declared =
        object.type === 'Identifier'
          ? declaredTypeOfIdentifier(object)
          : checker.getTypeAtLocation(tsNodeOf(object))

      return propertyValues(declared, property)
    }

    return closedValues(checker.getTypeAtLocation(tsNodeOf(node)), checker)
  }

  /**
   * The type the code declares for the expression `node`, never one inferred from `node` itself
   * (a type parameter it would instantiate is read by its constraint).
   */
  const declaredAt = (node) =>
    checker.getContextualType(tsNodeOf(node), ts.ContextFlags.IgnoreNodeInferences)

  /**
   * The string values the code admits at the string `node`, if it admits only some: the type it
   * declares there, the other side of a comparison, the discriminant of a `switch`; a property's
   * value is read across every member of a union its object is expected to be, so a discriminant
   * (`{ kind: 'member' }` of a union of kinds) admits every kind.
   */
  function expectedAt(node) {
    const { parent } = node

    if (parent?.type === 'BinaryExpression' && COMPARISONS.has(parent.operator)) {
      return declaredValuesOf(parent.left === node ? parent.right : parent.left)
    }

    if (parent?.type === 'SwitchCase' && parent.test === node) {
      return declaredValuesOf(parent.parent.discriminant)
    }

    if (
      parent?.type === 'Property' &&
      parent.value === node &&
      parent.parent?.type === 'ObjectExpression'
    ) {
      const object = declaredAt(parent.parent)
      const name =
        parent.key.type === 'Identifier' && !parent.computed
          ? parent.key.name
          : typeof parent.key.value === 'string'
            ? parent.key.value
            : undefined

      if (object?.isUnion() && name !== undefined) {
        return propertyValues(object, name)
      }
    }

    const declared = declaredAt(node)

    return declared === undefined ? undefined : closedValues(declared, checker)
  }

  /**
   * The names of the keys the object `objectNode` is expected to have, when its expected type is
   * a map over a union of them (`Record<Role, …>`, `Partial<…>` of one): an object type that
   * declares its fields (`{ identity: string }`), or a mapping of one (`Partial<Filter>`), names
   * fields, not roles.
   */
  function expectedKeys(objectNode) {
    const declared = declaredAt(objectNode)
    // An optional map (`Partial<Record<Role, …>> | undefined`) is the map.
    const members =
      declared === undefined
        ? []
        : (declared.isUnion() ? declared.types : [declared]).filter(
            (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
          )
    const type = members.length === 1 ? members[0] : undefined

    if (
      type === undefined ||
      type.isUnion() ||
      !(type.flags & ts.TypeFlags.Object) ||
      !(type.objectFlags & ts.ObjectFlags.Mapped)
    ) {
      return undefined
    }

    const properties = checker.getPropertiesOfType(type)

    // A key of a map over a union has no declaration of its own; one that a mapped type keeps
    // from a declared object (`Partial<Filter>`) still points at that field.
    return properties.length > 0 && properties.every(fromKeyUnion)
      ? properties.map((property) => property.getName())
      : undefined
  }

  return { expectedAt, expectedKeys }
}
