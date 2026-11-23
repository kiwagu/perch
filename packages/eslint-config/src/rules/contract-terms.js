/**
 * Reports a role or a route of the UI contract written by hand as a string where the code expects
 * a role or a route: code and tests name them through `CONTRACT_ROLES` and `CONTRACT_ROUTES`, the
 * constants the contract's engine emits (`ui-contract emit terms`), so a role or a route is said
 * once, in the contract. The option `module` is the absolute path of that module; the rule reads
 * its two constants (a missing or malformed module fails the lint, never passes it).
 *
 * The code expects a role where TypeScript does: the type the code declares at the literal (a
 * parameter, an element of a typed list, a typed property or return; never a type inferred from
 * the literal itself, and a type parameter by its constraint), the declared type of the other side
 * of `===`, `!==`, `==` or `!=`, or of the discriminant of the `switch` a `case` tests (never as
 * the flow narrowed it), is made of string literal types that are all roles of the contract
 * (`undefined` and `null` aside). A property's value is read across every member of the union its
 * object is expected to be, so a discriminant shared with other kinds is no role. A property key,
 * quoted or written as a name, of an object whose expected keys are all roles is one too. Routes are found the same way. Role names are common words (`identity` and `member`
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

import ts from 'typescript'

import { readContractTerms } from './contract-terms-module.js'
import { routeInPattern, routeNamedBy, routeStartingQuasi } from './route-values.js'

export { readContractTerms } from './contract-terms-module.js'

const COMPARISONS = new Set(['===', '!==', '==', '!='])

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

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

/** Whether `values` names something, and every value of it is a key of `known`. */
const within = (values, known) =>
  values !== undefined && values.length > 0 && values.every((value) => known.has(value))

/** How the constant names `key`: `NAME.key`, or `NAME["key"]` for a key that is no identifier. */
const access = (name, key) =>
  IDENTIFIER.test(key) ? `${name}.${key}` : `${name}[${JSON.stringify(key)}]`

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

        const index = checker
          .getIndexInfosOfType(member)
          .find(({ keyType }) => keyType.flags & ts.TypeFlags.String)

        // An index that holds nothing (`Record<string, never>`) admits no value under the name.
        return index === undefined || index.type.flags & ts.TypeFlags.Never
          ? []
          : closedValues(index.type, checker)
      })

      return values.some((each) => each === undefined) ? undefined : values.flat()
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
     * every member of its object's declared union; any other expression by its type.
     */
    function declaredValuesOf(node) {
      if (node.type === 'Identifier') {
        return closedValues(declaredTypeOfIdentifier(node), checker)
      }

      const property = node.type === 'MemberExpression' ? propertyNameOf(node) : undefined

      if (property !== undefined) {
        const declared =
          node.object.type === 'Identifier'
            ? declaredTypeOfIdentifier(node.object)
            : checker.getTypeAtLocation(tsNodeOf(node.object))

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
      const type = declaredAt(objectNode)

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

      if (parent?.type === 'Property' && parent.key === node) {
        checkExpected(node, value, expectedKeys(parent.parent))

        return
      }

      checkExpected(node, value, expectedAt(node))
    }

    return {
      Property(node) {
        // A key written as a name (`{ operator: … }`, or `{ member }` with a variable of that name)
        // is a role as much as a quoted one.
        if (
          node.key.type === 'Identifier' &&
          !node.computed &&
          node.kind === 'init' &&
          node.parent?.type === 'ObjectExpression'
        ) {
          checkExpected(node.key, node.key.name, expectedKeys(node.parent))
        }
      },
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
