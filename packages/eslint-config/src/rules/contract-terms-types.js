/**
 * How the contract-terms rule reads TypeScript's types: the string values the code admits where a
 * string stands (the type it declares there, never one inferred from the string or narrowed by
 * the flow; the declared side of a comparison or a switch; a property's values across the members
 * of its object's union), and the keys a map is expected to have when they come from a union of
 * keys. A value set is closed only when it is made of string literals.
 */

import ts from 'typescript'

import { closedValues, readings } from './contract-terms-readings.js'

const COMPARISONS = new Set(['===', '!==', '==', '!='])

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

/** The text of the string `node`: a literal or a template with no expression. */
const stringOf = (node) => (node.type === 'Literal' ? node.value : node.quasis[0]?.value.cooked)

/** Whether `node` is an `as const` assertion. */
const isConstAssertion = (node) =>
  node?.type === 'TSAsExpression' &&
  node.typeAnnotation.type === 'TSTypeReference' &&
  node.typeAnnotation.typeName.type === 'Identifier' &&
  node.typeAnnotation.typeName.name === 'const'

/** The names that say a list holds roles or routes: `PLATFORM_ROLES`, `heldRoles`, `routes`. */
const TERMS_NAME = /(^|_|[a-z])(roles?|routes?)$/i

/**
 * Whether the `as const` list `array` says it holds roles or routes: a constant of the contract
 * among its items (`CONTRACT_ROLES.admin`), or the name it is declared under.
 */
function holdsTerms(array) {
  const constant = array.elements.some(
    (element) =>
      element?.type === 'MemberExpression' &&
      element.object.type === 'Identifier' &&
      /^CONTRACT_(ROLES|ROUTES)$/.test(element.object.name),
  )
  const holder = array.parent?.parent
  const name =
    holder?.type === 'VariableDeclarator' && holder.id.type === 'Identifier'
      ? holder.id.name
      : holder?.type === 'Property' && holder.key.type === 'Identifier'
        ? holder.key.name
        : undefined

  return constant || (name !== undefined && TERMS_NAME.test(name))
}

/** Whether the member access `node` writes its key as a number: `a[0]`. */
const isNumericKey = (node) =>
  node.computed && node.property.type === 'Literal' && typeof node.property.value === 'number'

/** The readers of the types of one file, over its parser services' program. */
export function typeReaders(services) {
  const checker = services.program.getTypeChecker()
  const tsNodeOf = (node) => services.esTreeNodeToTSNodeMap.get(node)
  const { membersOf, readingOf, both, readingValues } = readings(checker)

  /**
   * The indexes of `member` that take the property `name`, as TypeScript picks them: those over
   * particular keys (a pattern, `number` for a numeric name), and only when none does, the one
   * over every string. A key written as a number (`a[0]`) is taken by its number, never as text.
   */
  function indexesTaking(member, name, numeric) {
    const taking = checker
      .getIndexInfosOfType(member)
      .filter(({ keyType }) =>
        numeric
          ? checker.isTypeAssignableTo(checker.getNumberLiteralType(Number(name)), keyType) ||
            Boolean(keyType.flags & ts.TypeFlags.String)
          : indexTakes(keyType, name),
      )
    const particular = taking.filter(({ keyType }) => !(keyType.flags & ts.TypeFlags.String))

    return particular.length > 0 ? particular : taking
  }

  /**
   * The reading of the property `name` of one type: its own property's type, or what the indexes
   * that take the name hold, all at once; none when the type has neither.
   */
  function propertyOfType(type, name, numeric) {
    const field = checker.getPropertyOfType(type, name)

    if (field !== undefined) {
      return readingOf(checker.getTypeOfSymbol(field))
    }

    const indexes = indexesTaking(type, name, numeric)

    return indexes.length === 0
      ? undefined
      : indexes.map(({ type: held }) => readingOf(held)).reduce(both)
  }

  /**
   * The reading of the property `name` across the alternatives of `reading`: an alternative none
   * of whose types has it adds none; one several of whose types have it holds each at once.
   */
  const propertyReading = (reading, name, numeric = false) =>
    reading.flatMap((alternative) => {
      const parts = alternative
        .map((type) => propertyOfType(type, name, numeric))
        .filter((part) => part !== undefined)

      return parts.length === 0 ? [] : parts.reduce(both)
    })

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

  /** The name of the property `a.b`, `a['b']`, ``a[`b`]`` or `a[0]` reads, when it is written out. */
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

    if (node.property.type === 'Literal' && typeof node.property.value === 'number') {
      return String(node.property.value)
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
   * The reading of the expression `node` as declared, never as the flow narrowed it where it
   * stands: a variable by its declaration, `this` by its class's, `a.b` or `a[0]` by the property
   * across `a`'s declared reading, at any depth and through `?.` and `!`; any other expression, a
   * call among them, by its type there.
   */
  function declaredReadingOf(node) {
    const bare = unwrapped(node)

    if (bare.type === 'Identifier') {
      return readingOf(declaredTypeOfIdentifier(bare))
    }

    if (bare.type === 'ThisExpression') {
      const declared = classTypeOf(bare)

      return readingOf(declared ?? checker.getTypeAtLocation(tsNodeOf(bare)))
    }

    const property = bare.type === 'MemberExpression' ? propertyNameOf(bare) : undefined

    return property === undefined
      ? readingOf(checker.getTypeAtLocation(tsNodeOf(bare)))
      : propertyReading(declaredReadingOf(bare.object), property, isNumericKey(bare))
  }

  /**
   * The type `this` (`node`) has in its class, as declared: the instance type in a method or a
   * field (an arrow in it too), the class itself (its constructor) in a static one or a static
   * block; none in a function that is no method, a field's value among them, which binds its own.
   */
  function classTypeOf(node) {
    let isStatic = false
    let member = false
    let at = node.parent

    while (at !== undefined && at !== null) {
      // A function binds its own `this`, but a method's: a function in a field's value does too.
      if (
        (at.type === 'FunctionDeclaration' || at.type === 'FunctionExpression') &&
        at.parent?.type !== 'MethodDefinition'
      ) {
        return undefined
      }

      if (
        !member &&
        (at.type === 'MethodDefinition' ||
          at.type === 'PropertyDefinition' ||
          at.type === 'StaticBlock')
      ) {
        member = true
        isStatic = at.type === 'StaticBlock' || at.static === true
      }

      if (at.type === 'ClassDeclaration' || at.type === 'ClassExpression') {
        const symbol = at.id === null ? undefined : checker.getSymbolAtLocation(tsNodeOf(at.id))

        if (symbol === undefined) {
          return undefined
        }

        return isStatic ? checker.getTypeOfSymbol(symbol) : checker.getDeclaredTypeOfSymbol(symbol)
      }

      at = at.parent
    }

    return undefined
  }

  /**
   * The string values the expression `node` admits as declared (`declaredReadingOf`), so a
   * discriminant narrowed where it is compared still admits every kind its union declares.
   */
  const declaredValuesOf = (node) => readingValues(declaredReadingOf(node))

  /** Whether the expression `node` is declared `unknown`, as `declaredReadingOf` reads it. */
  function isUnknown(node) {
    const reading = declaredReadingOf(node)

    return (
      reading.length > 0 &&
      reading.every((alternative) =>
        alternative.every((type) => Boolean(type.flags & ts.TypeFlags.Unknown)),
      )
    )
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
      const other = parent.left === node ? parent.right : parent.left
      const values = declaredValuesOf(other)

      // A value the code knows nothing of, compared with a string: the code asks whether it is
      // that string, so the string is all it admits there.
      return values === undefined && isUnknown(other) ? [stringOf(node)] : values
    }

    // A list frozen `as const` admits what it lists: two strings or more that are all roles are a
    // list of roles. One string alone (`['identity'] as const`, a table) says too little, unless
    // the list says what it holds: a constant of the contract among its items, or its name.
    if (parent?.type === 'ArrayExpression' && isConstAssertion(parent.parent)) {
      const listed = parent.elements.map((element) =>
        element?.type === 'Literal' && typeof element.value === 'string'
          ? element.value
          : undefined,
      )

      if (holdsTerms(parent)) {
        return [stringOf(node)]
      }

      if (listed.length >= 2 && listed.every((each) => each !== undefined)) {
        return listed
      }
    }

    if (parent?.type === 'SwitchCase' && parent.test === node) {
      const values = declaredValuesOf(parent.parent.discriminant)

      return values === undefined && isUnknown(parent.parent.discriminant)
        ? [stringOf(node)]
        : values
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
        return readingValues(propertyReading(readingOf(object), name))
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
    // An optional map (`Partial<Record<Role, …>> | undefined`) is the map; several maps over key
    // unions expect the keys of each.
    const maps = declared === undefined ? [] : membersOf(declared).map(keysOfMap)

    return maps.length > 0 && maps.every((keys) => keys !== undefined)
      ? [...new Set(maps.flat())]
      : undefined
  }

  /** The keys of `type` when it is a map over a union of keys, with no field declared for one. */
  function keysOfMap(type) {
    if (
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
