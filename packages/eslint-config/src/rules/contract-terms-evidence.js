/**
 * What a string's surroundings say it holds, for the contract-terms rule where TypeScript's types
 * say nothing: a list frozen `as const` that names its family (a constant of the contract among its
 * items, a name that says roles), and a name that says roles or routes.
 */

/** The text of the string `node`: a literal or a template with no expression. */
export const stringOf = (node) =>
  node.type === 'Literal' ? node.value : node.quasis[0]?.value.cooked

/** Whether `node` is an `as const` assertion. */
export const isConstAssertion = (node) =>
  node?.type === 'TSAsExpression' &&
  node.typeAnnotation.type === 'TSTypeReference' &&
  node.typeAnnotation.typeName.type === 'Identifier' &&
  node.typeAnnotation.typeName.name === 'const'

/** The family a name says it holds: `PLATFORM_ROLES`, `heldRole` roles; `pathname`, `route` routes. */
export function termsNamed(name) {
  if (name === undefined) {
    return undefined
  }

  if (/(^|_|[a-z])roles?$/i.test(name)) {
    return 'roles'
  }

  return /(^|_|[a-z])(routes?|path|pathname)$/i.test(name) ? 'routes' : undefined
}

/**
 * The family the `as const` list `array` says it holds: a constant of the contract among its items
 * (`CONTRACT_ROLES.admin`, `CONTRACT_ROUTES['user.profile']`), or a name that says roles. A name
 * never says routes: the gateway's lists of its own API paths would read as the screens' routes.
 */
export function holdsTerms(array) {
  const constants = array.elements.flatMap((element) =>
    element?.type === 'MemberExpression' && element.object.type === 'Identifier'
      ? [element.object.name]
      : [],
  )

  if (constants.includes('CONTRACT_ROLES')) {
    return 'roles'
  }

  if (constants.includes('CONTRACT_ROUTES')) {
    return 'routes'
  }

  const holder = array.parent?.parent
  const name =
    holder?.type === 'VariableDeclarator' && holder.id.type === 'Identifier'
      ? holder.id.name
      : holder?.type === 'Property' && holder.key.type === 'Identifier'
        ? holder.key.name
        : undefined

  return termsNamed(name) === 'roles' ? 'roles' : undefined
}
