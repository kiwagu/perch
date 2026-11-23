/**
 * Reports a role or a route of the UI contract written by hand as a string where the code expects
 * a role or a route: code and tests name them through `CONTRACT_ROLES` and `CONTRACT_ROUTES`, the
 * constants the contract's engine emits (`ui-contract emit terms`), so a role or a route is said
 * once, in the contract. The option `module` is the absolute path of that module; the rule reads
 * its two constants (a missing or malformed module fails the lint, never passes it).
 *
 * The code expects a role where TypeScript does: the literal's contextual type (a parameter, an
 * element of a typed list, a typed property or return), the other side of `===`, `!==`, `==` or
 * `!=`, or the discriminant of the `switch` a `case` tests, is made of string literal types that
 * are all roles of the contract (`undefined` and `null` aside, a type parameter read by its
 * constraint). A property key of an object whose contextual type has only roles as its keys is
 * one too. Routes are found the same way. Role names are common words (`identity` and `member`
 * are tables too) and `/devices` is also a gateway API path, so a string elsewhere is left alone.
 * Type annotations are not read: a type is held by the compiler once it derives from the
 * constants.
 *
 * With `routeValues: true` (where no other kind of path is written, the e2e tests: Playwright's
 * `goto` takes any string) every string naming a route by its value is reported too: a string
 * literal that is a route, or a route followed by `?` or `#`; a part of a template literal that
 * starts so; a regular expression that names a route ending there (`/\/me$/`). A sub-path
 * (`/settings/x`) and a longer word (`/settingsx`) are not routes. Needs type information
 * (typescript-eslint `projectService`); without it the rule fails rather than pass in silence.
 */

import { readFileSync } from 'node:fs'

import ts from 'typescript'

const COMPARISONS = new Set(['===', '!==', '==', '!='])

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** The string entries of the object literal `name` exports in `source`. */
function constantOf(source, name, path) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
        continue
      }

      const value =
        declaration.initializer !== undefined && ts.isAsExpression(declaration.initializer)
          ? declaration.initializer.expression
          : declaration.initializer

      if (value === undefined || !ts.isObjectLiteralExpression(value)) {
        throw new Error(`${path}: ${name} is not an object literal`)
      }

      return value.properties.map((property) => {
        if (
          !ts.isPropertyAssignment(property) ||
          !ts.isStringLiteral(property.name) ||
          !ts.isStringLiteral(property.initializer)
        ) {
          throw new Error(`${path}: an entry of ${name} is not a string written as a string`)
        }

        return [property.name.text, property.initializer.text]
      })
    }
  }

  throw new Error(`${path}: no ${name}; write it with \`ui-contract emit terms\``)
}

const cache = new Map()

/**
 * The roles and the routes the module at `path` holds: each role by its name, each route by its
 * path with the screen's id that names it. Read once per path and version of the file.
 */
export function readContractTerms(path) {
  let text

  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`${path}: no such module; write it with \`ui-contract emit terms\``)
  }

  const cached = cache.get(path)

  if (cached?.text === text) {
    return cached.terms
  }

  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const terms = {
    roles: new Map(constantOf(source, 'CONTRACT_ROLES', path).map(([, role]) => [role, role])),
    routes: new Map(constantOf(source, 'CONTRACT_ROUTES', path).map(([id, route]) => [route, id])),
  }

  cache.set(path, { text, terms })

  return terms
}

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

/** Whether every value of `values` is a key of `known`. */
const within = (values, known) => values?.every((value) => known.has(value)) ?? false

/** How the constant names `key`: `NAME.key`, or `NAME["key"]` for a key that is no identifier. */
const access = (name, key) =>
  IDENTIFIER.test(key) ? `${name}.${key}` : `${name}[${JSON.stringify(key)}]`

/** The route `text` names by its value: the route itself, or a route followed by `?` or `#`. */
function routeNamedBy(text, routes) {
  for (const route of routes.keys()) {
    if (
      text === route ||
      (!route.includes('$') && (text.startsWith(`${route}?`) || text.startsWith(`${route}#`)))
    ) {
      return route
    }
  }

  return undefined
}

/** The route a part of a template literal starts with, an expression or the end right after it. */
function routeStartingQuasi(text, routes) {
  for (const route of routes.keys()) {
    if (!route.includes('$') && text.startsWith(route)) {
      const next = text.charAt(route.length)

      if (next === '' || next === '?' || next === '#') {
        return route
      }
    }
  }

  return undefined
}

/** The route a regular expression names where it ends: `/\/me$/`, `/^\/settings(\?|$)/`. */
function routeInPattern(pattern, routes) {
  const text = pattern.replaceAll('\\/', '/')

  for (const route of routes.keys()) {
    if (route.includes('$')) {
      continue
    }

    for (let at = text.indexOf(route); at !== -1; at = text.indexOf(route, at + 1)) {
      const before = at === 0 ? '' : text.charAt(at - 1)
      const after = text.slice(at + route.length)

      if (!/[\w-]/.test(before) && /^($|\$|\\\?|#|\(|\)|\|)/.test(after)) {
        return route
      }
    }
  }

  return undefined
}

/** @type {import('eslint').Rule.RuleModule} */
export const contractTerms = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow a role or a route of the UI contract written by hand',
    },
    messages: {
      role: '"{{value}}" is a role of the contract written by hand: name it {{name}}, from the module the contract emits.',
      route:
        '"{{value}}" names a route of the contract by hand: name it {{name}}, from the module the contract emits.',
    },
    schema: [
      {
        type: 'object',
        properties: { module: { type: 'string' }, routeValues: { type: 'boolean' } },
        required: ['module'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ module, routeValues = false }] = context.options
    const { roles, routes } = readContractTerms(module)
    const services = context.sourceCode.parserServices

    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('workspace/contract-terms needs type information (projectService)')
    }

    const checker = services.program.getTypeChecker()
    const typeOf = (node) => checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node))

    /** The type the code expects at the string `node`, if it expects one. */
    function expectedAt(node) {
      const { parent } = node

      if (parent?.type === 'BinaryExpression' && COMPARISONS.has(parent.operator)) {
        return typeOf(parent.left === node ? parent.right : parent.left)
      }

      if (parent?.type === 'SwitchCase' && parent.test === node) {
        return typeOf(parent.parent.discriminant)
      }

      return checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node))
    }

    /** The names of the keys the object `objectNode` is expected to have, if it is expected. */
    function expectedKeys(objectNode) {
      const type = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(objectNode))

      if (type === undefined || type.isUnion()) {
        return undefined
      }

      const names = checker.getPropertiesOfType(type).map((property) => property.getName())

      return names.length > 0 ? names : undefined
    }

    function reportRole(node, value) {
      context.report({
        node,
        messageId: 'role',
        data: { value, name: access('CONTRACT_ROLES', value) },
      })
    }

    function reportRoute(node, value) {
      context.report({
        node,
        messageId: 'route',
        data: { value, name: access('CONTRACT_ROUTES', routes.get(value)) },
      })
    }

    /** Reports the string `value` at `node` when the code expects a role or a route there. */
    function checkExpected(node, value, values) {
      if (values === undefined) {
        return
      }

      if (within(values, roles) && roles.has(value)) {
        reportRole(node, value)
      } else if (within(values, routes) && routes.has(value)) {
        reportRoute(node, value)
      }
    }

    function checkString(node, value) {
      const { parent } = node

      if (parent?.type === 'TSLiteralType' || parent?.type === 'ImportDeclaration') {
        return
      }

      if (routeValues) {
        const route = routeNamedBy(value, routes)

        if (route !== undefined) {
          reportRoute(node, route)

          return
        }
      }

      if (parent?.type === 'Property' && parent.key === node && !parent.computed) {
        checkExpected(node, value, expectedKeys(parent.parent))

        return
      }

      const expected = expectedAt(node)

      checkExpected(
        node,
        value,
        expected === undefined ? undefined : closedValues(expected, checker),
      )
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkString(node, node.value)
        } else if (routeValues && node.regex !== undefined) {
          const route = routeInPattern(node.regex.pattern, routes)

          if (route !== undefined) {
            reportRoute(node, route)
          }
        }
      },
      TemplateLiteral(node) {
        if (node.parent?.type === 'TaggedTemplateExpression') {
          return
        }

        if (node.expressions.length === 0) {
          checkString(node, node.quasis[0]?.value.cooked ?? '')

          return
        }

        if (!routeValues) {
          return
        }

        for (const quasi of node.quasis) {
          const route = routeStartingQuasi(quasi.value.cooked ?? '', routes)

          if (route !== undefined) {
            reportRoute(node, route)

            return
          }
        }
      },
    }
  },
}
